
const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json({limit:'1mb'}));
app.use(express.static(path.join(__dirname,'public')));
const PORT = process.env.PORT || 10000;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL?.includes('render.com') ? { rejectUnauthorized:false } : undefined });
const JWT_SECRET = process.env.JWT_SECRET;
const HOST_PASSWORD = process.env.HOST_PASSWORD;
if (!JWT_SECRET || !HOST_PASSWORD || !process.env.DATABASE_URL) {
  console.warn('Set DATABASE_URL, JWT_SECRET, and HOST_PASSWORD in Render environment variables.');
}
const challenges = JSON.parse(fs.readFileSync(path.join(__dirname,'challenges.json'),'utf8'));
const XP = { Excellent:5000, Good:3000, Acceptable:1000, 'Major Mistake':-6000 };
const CROWN = { Excellent:100, Good:80, Acceptable:50, 'Major Mistake':-120 };
const STARTING_BALANCE = 500000000;
// Strategic phase choices are intentionally not tied to one universally optimal path.
const PHASES = {
 strategy:[
  {id:'balanced',label:'Balanced Royal Policy',cost:0,stats:{stability:2}},
  {id:'growth',label:'Aggressive Expansion',cost:15000000,stats:{trade_power:3,stability:-1}},
  {id:'citizens',label:'Citizen-first Investment',cost:20000000,stats:{food_reserve:3,stability:3}},
  {id:'defense',label:'Security-first Policy',cost:12000000,stats:{military_readiness:4,stability:1}}
 ], operations:[
  {id:'local',label:'Local workforce & suppliers',cost:10000000,stats:{stability:2,food_reserve:1}},
  {id:'import',label:'Imported experts & materials',cost:25000000,stats:{infrastructure:3,trade_power:2}},
  {id:'automation',label:'Automation & technology',cost:30000000,stats:{infrastructure:4,trade_power:1}},
  {id:'rapid',label:'Rapid deployment',cost:5000000,stats:{stability:-2,military_readiness:1}}
 ], protection:[
  {id:'insured',label:'Insure and diversify',cost:18000000,stats:{insurance:3,stability:1},risk:0.10},
  {id:'reserve',label:'Build emergency reserves',cost:25000000,stats:{food_reserve:3,insurance:1},risk:0.08},
  {id:'hedge',label:'Trade hedge & contracts',cost:12000000,stats:{trade_power:2,insurance:2},risk:0.16},
  {id:'unprotected',label:'Accept exposure; keep cash',cost:0,stats:{},risk:0.30}
 ]
};
const MARKET_EVENTS=[
 {id:'harvest_bumper',title:'Strong Harvest',hint:'Agricultural output is unexpectedly strong.',effect:{food_reserve:1},multiplier:1.18},
 {id:'supply_shock',title:'Supply Chain Shock',hint:'Shipping and imported materials may cost more.',effect:{trade_power:-1},multiplier:0.78},
 {id:'credit_tight',title:'Credit Tightening',hint:'Lenders are cautious; liquidity matters.',effect:{stability:-1},multiplier:0.82},
 {id:'trade_window',title:'Unexpected Trade Window',hint:'A new trade route may reward commercial planning.',effect:{trade_power:1},multiplier:1.22},
 {id:'security_alert',title:'Security Alert',hint:'A regional security concern is emerging.',effect:{military_readiness:-1},multiplier:0.84},
 {id:'calm_market',title:'Stable Market',hint:'Markets are calm, but execution still matters.',effect:{stability:1},multiplier:1.02}
];
function marketFor(index){return MARKET_EVENTS[(index*7+Math.floor(Math.random()*MARKET_EVENTS.length))%MARKET_EVENTS.length];}
function mergeStats(base,add){for(const [k,v] of Object.entries(add||{}))base[k]=(Number(base[k])||0)+Number(v||0);return base;}
function phaseById(type,id){return (PHASES[type]||[]).find(x=>x.id===id);}


async function init(){
 await pool.query(`
 CREATE TABLE IF NOT EXISTS players(
  id SERIAL PRIMARY KEY, name TEXT NOT NULL, name_key TEXT UNIQUE NOT NULL,
  access_hash TEXT, approved BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW(),
  balance BIGINT NOT NULL DEFAULT ${STARTING_BALANCE}, xp BIGINT NOT NULL DEFAULT 0,
  crown_points BIGINT NOT NULL DEFAULT 0, eliminated BOOLEAN NOT NULL DEFAULT false,
  kingdom_state JSONB NOT NULL DEFAULT '{"food_reserve":0,"infrastructure":0,"stability":0,"trade_power":0,"military_readiness":0,"insurance":0}'::jsonb
 );
 ALTER TABLE players ADD COLUMN IF NOT EXISTS kingdom_state JSONB NOT NULL DEFAULT '{"food_reserve":0,"infrastructure":0,"stability":0,"trade_power":0,"military_readiness":0,"insurance":0}'::jsonb;
 CREATE TABLE IF NOT EXISTS game_state(
  id INTEGER PRIMARY KEY CHECK(id=1), current_challenge INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'registration', submissions_locked BOOLEAN NOT NULL DEFAULT false,
  revealed BOOLEAN NOT NULL DEFAULT false, results_approved BOOLEAN NOT NULL DEFAULT false,
  game_night INTEGER NOT NULL DEFAULT 1, updated_at TIMESTAMPTZ DEFAULT NOW(),
  current_set INTEGER NOT NULL DEFAULT 1, set_started BOOLEAN NOT NULL DEFAULT false,
  market_event JSONB NOT NULL DEFAULT '{}'::jsonb
 );
 ALTER TABLE game_state ADD COLUMN IF NOT EXISTS current_set INTEGER NOT NULL DEFAULT 1;
 ALTER TABLE game_state ADD COLUMN IF NOT EXISTS set_started BOOLEAN NOT NULL DEFAULT false;
 ALTER TABLE game_state ADD COLUMN IF NOT EXISTS market_event JSONB NOT NULL DEFAULT '{}'::jsonb;
 INSERT INTO game_state(id) VALUES(1) ON CONFLICT DO NOTHING;
 CREATE TABLE IF NOT EXISTS submissions(
  id SERIAL PRIMARY KEY, player_id INTEGER REFERENCES players(id) ON DELETE CASCADE,
  challenge_index INTEGER NOT NULL, option_key TEXT NOT NULL, submitted_at TIMESTAMPTZ DEFAULT NOW(),
  decision_data JSONB NOT NULL DEFAULT '{}'::jsonb, intelligence_cost BIGINT NOT NULL DEFAULT 0,
  UNIQUE(player_id,challenge_index)
 );
 ALTER TABLE submissions ADD COLUMN IF NOT EXISTS decision_data JSONB NOT NULL DEFAULT '{}'::jsonb;
 ALTER TABLE submissions ADD COLUMN IF NOT EXISTS intelligence_cost BIGINT NOT NULL DEFAULT 0;
 CREATE TABLE IF NOT EXISTS intelligence_purchases(id SERIAL PRIMARY KEY,player_id INTEGER REFERENCES players(id) ON DELETE CASCADE,challenge_index INTEGER NOT NULL,cost BIGINT NOT NULL,tier INTEGER NOT NULL,created_at TIMESTAMPTZ DEFAULT NOW(),UNIQUE(player_id,challenge_index));
 CREATE TABLE IF NOT EXISTS results(
  id SERIAL PRIMARY KEY, player_id INTEGER REFERENCES players(id) ON DELETE CASCADE,
  challenge_index INTEGER NOT NULL, option_key TEXT NOT NULL, cost BIGINT NOT NULL,
  revenue BIGINT NOT NULL, net BIGINT NOT NULL, quality TEXT NOT NULL,
  xp_delta INTEGER NOT NULL, crown_delta INTEGER NOT NULL, balance_after BIGINT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(player_id,challenge_index)
 );
 `);
}
function token(req){ const h=req.headers.authorization||''; return h.startsWith('Bearer ')?h.slice(7):null; }
function auth(req,res,next){
 try{ const t=token(req); if(!t) return res.status(401).json({error:'Please sign in.'}); req.user=jwt.verify(t,JWT_SECRET); next(); }
 catch(e){ return res.status(401).json({error:'Session expired. Sign in again.'}); }
}
function host(req,res,next){ if(req.user?.role!=='host') return res.status(403).json({error:'Host access required.'}); next(); }
const money=n=>'₦'+Number(n).toLocaleString('en-NG');
async function state(){return (await pool.query('SELECT * FROM game_state WHERE id=1')).rows[0];}
async function playerSafe(id){return (await pool.query('SELECT id,name,approved,balance,xp,crown_points,eliminated,kingdom_state FROM players WHERE id=$1',[id])).rows[0];}
app.get('/api/health', async(req,res)=>{try{await pool.query('SELECT 1');res.json({ok:true,service:'KINGMAKERS ARENA'});}catch(e){res.status(500).json({ok:false,error:'Database unavailable'});}});
app.post('/api/register',async(req,res)=>{
 const name=String(req.body.name||'').trim().replace(/\s+/g,' ');
 if(name.length<2||name.length>40) return res.status(400).json({error:'Player name must be 2–40 characters.'});
 const key=name.toLowerCase();
 try{
  const q=await pool.query('INSERT INTO players(name,name_key) VALUES($1,$2) RETURNING id,name,approved',[name,key]);
  res.json({message:'Registration submitted. Wait for the Royal Host to approve you.',player:q.rows[0]});
 }catch(e){ if(e.code==='23505') return res.status(409).json({error:'That player name is already registered.'}); res.status(500).json({error:'Registration failed.'});}
});
app.post('/api/login',async(req,res)=>{
 const name=String(req.body.name||'').trim().toLowerCase(), code=String(req.body.code||'').trim();
 const q=await pool.query('SELECT * FROM players WHERE name_key=$1',[name]);
 if(!q.rowCount||!q.rows[0].approved||!q.rows[0].access_hash) return res.status(401).json({error:'Player not approved or credentials incorrect.'});
 if(!await bcrypt.compare(code,q.rows[0].access_hash)) return res.status(401).json({error:'Player name or access code is incorrect.'});
 const p=q.rows[0]; const t=jwt.sign({id:p.id,role:'player'},JWT_SECRET,{expiresIn:'30d'});
 res.json({token:t,player:await playerSafe(p.id)});
});
app.post('/api/host/login',async(req,res)=>{
 if(!HOST_PASSWORD||String(req.body.password||'')!==HOST_PASSWORD) return res.status(401).json({error:'Incorrect host password.'});
 const t=jwt.sign({role:'host'},JWT_SECRET,{expiresIn:'12h'});
 res.json({token:t});
});
app.get('/api/me',auth,async(req,res)=>{
 if(req.user.role==='host') return res.json({role:'host'});
 const p=await playerSafe(req.user.id); if(!p) return res.status(404).json({error:'Player not found.'});
 res.json({role:'player',player:p});
});
app.get('/api/game',auth,async(req,res)=>{
 const s=await state(); const leaderboard=(await pool.query('SELECT name,balance,xp,crown_points,eliminated FROM players WHERE approved=true ORDER BY crown_points DESC,xp DESC,balance DESC')).rows;
 let current=null;
 if(s.current_challenge>=0&&s.current_challenge<challenges.length){
  const c=challenges[s.current_challenge];
  current={index:s.current_challenge,set_number:c.set_number,set_name:c.set_name,challenge_number:c.challenge_number,title:c.title,scenario:c.scenario,
    options:c.options.map(o=>({key:o.key,name:o.name,description:o.description,cost:o.cost})), phases:PHASES, market_hint:(!s.revealed&&!s.results_approved)?(s.market_event?.hint||'Royal intelligence is limited.'):null};
 }
 let player=null, submitted=null, revealed_details=[];
 if(req.user.role==='player'){
  player=await playerSafe(req.user.id);
  const sub=await pool.query('SELECT option_key,decision_data,intelligence_cost FROM submissions WHERE player_id=$1 AND challenge_index=$2',[req.user.id,s.current_challenge]);
  submitted=sub.rowCount?sub.rows[0].option_key:null;
 }
 // Keep choices secret until the host explicitly reveals the challenge.
 if(s.revealed || s.results_approved){
  const allSubs=(await pool.query('SELECT p.name,sub.option_key,sub.submitted_at FROM submissions sub JOIN players p ON p.id=sub.player_id WHERE sub.challenge_index=$1 AND p.approved=true ORDER BY p.name',[s.current_challenge])).rows;
  const ch=challenges[s.current_challenge];
  revealed_details=allSubs.map(row=>{const opt=ch.options.find(o=>o.key===row.option_key);return opt?{name:row.name,option_key:opt.key,option_name:opt.name,cost:opt.cost,revenue:opt.revenue,net:opt.revenue-opt.cost,quality:opt.quality,submitted_at:row.submitted_at}:null;}).filter(Boolean);
 }
 res.json({state:s,current,player,submitted,leaderboard,revealed_details,challenge_count:challenges.length});
});
app.get('/api/host/pending',auth,host,async(req,res)=>{
 const q=await pool.query('SELECT id,name,created_at FROM players WHERE approved=false ORDER BY created_at');
 res.json({pending:q.rows});
});
app.post('/api/host/approve/:id',auth,host,async(req,res)=>{
 const id=Number(req.params.id); const q=await pool.query('SELECT * FROM players WHERE id=$1 AND approved=false',[id]);
 if(!q.rowCount) return res.status(404).json({error:'Pending player not found.'});
 const code=crypto.randomBytes(5).toString('hex').toUpperCase();
 const hash=await bcrypt.hash(code,10);
 await pool.query('UPDATE players SET approved=true,access_hash=$1,balance=$2 WHERE id=$3',[hash,STARTING_BALANCE,id]);
 res.json({name:q.rows[0].name,access_code:code,message:'Give this code to the player. It is shown only now.'});
});
app.post('/api/host/reject/:id',auth,host,async(req,res)=>{await pool.query('DELETE FROM players WHERE id=$1 AND approved=false',[Number(req.params.id)]);res.json({ok:true});});
app.get('/api/host/dashboard',auth,host,async(req,res)=>{
 const s=await state();
 const players=(await pool.query('SELECT id,name,approved,balance,xp,crown_points,eliminated,kingdom_state FROM players ORDER BY approved DESC,name')).rows;
 const subs=(await pool.query(`SELECT p.name,s.option_key,s.decision_data,s.intelligence_cost,s.challenge_index,s.submitted_at FROM submissions s JOIN players p ON p.id=s.player_id WHERE s.challenge_index=$1 ORDER BY p.name`,[s.current_challenge])).rows;
 const results=(await pool.query(`SELECT p.name,r.option_key,r.cost,r.revenue,r.net,r.quality,r.xp_delta,r.crown_delta,r.balance_after FROM results r JOIN players p ON p.id=r.player_id WHERE r.challenge_index=$1 ORDER BY p.name`,[s.current_challenge])).rows;
 const preview = s.revealed ? subs.map(sub=>{
  const ch=challenges[s.current_challenge], opt=ch.options.find(o=>o.key===sub.option_key),pl=players.find(p=>p.name===sub.name),dec=sub.decision_data||{};
  if(!opt||!pl)return null;const st=phaseById('strategy',dec.strategy),op=phaseById('operations',dec.operations),pr=phaseById('protection',dec.protection);if(!st||!op||!pr)return null;
  const intel=Number(sub.intelligence_cost||0),baseCost=Number(opt.cost)+st.cost+op.cost+pr.cost,totalCost=baseCost+intel,ks=pl.kingdom_state||{},event=s.market_event||MARKET_EVENTS[0];
  const assetBonus=Math.min(0.35,Math.max(-0.20,(Number(ks.infrastructure||0)+Number(ks.trade_power||0)+Number(ks.food_reserve||0)+Number(ks.stability||0)+Number(ks.military_readiness||0))/100));
  const phaseBonus=(Number(st.stats.trade_power||0)+Number(op.stats.infrastructure||0)+Number(pr.stats.insurance||0))*0.012;
  const exposure=(Number(event.multiplier||1)-1)*(1-Number(pr.risk||0))+assetBonus+phaseBonus;
  const revenue=Math.round(Number(opt.revenue)*(1+exposure)),net=revenue-totalCost,balance_after=Math.max(0,Number(pl.balance)+revenue-baseCost);
  const quality=net>150000000?'Excellent':net>60000000?'Good':net>=0?'Acceptable':'Major Mistake';
  return {name:sub.name,option_key:opt.key,decision_data:dec,strategy:st.label,operations:op.label,protection:pr.label,cost:totalCost,revenue,net,quality,xp_delta:XP[quality],crown_delta:CROWN[quality],balance_before:pl.balance,balance_after};
 }).filter(Boolean) : [];
 res.json({state:s,players,pending:players.filter(p=>!p.approved),submissions:subs,results,preview,current:challenges[s.current_challenge]||null,challenge_count:challenges.length,challenge_list:challenges.map(c=>({set_number:c.set_number,set_name:c.set_name,challenge_number:c.challenge_number,title:c.title}))});
});
app.post('/api/host/start',auth,host,async(req,res)=>{
 const setNo=Number(req.body.set_number||1); if(setNo<1||setNo>10)return res.status(400).json({error:'Set must be 1–10.'});
 const idx=challenges.findIndex(c=>c.set_number===setNo&&c.challenge_number===1); if(idx<0)return res.status(400).json({error:'Set not found.'});
 const ev=marketFor(idx); await pool.query("UPDATE game_state SET current_challenge=$1,current_set=$2,set_started=true,status='active',submissions_locked=false,revealed=false,results_approved=false,market_event=$3 WHERE id=1",[idx,setNo,JSON.stringify(ev)]);
 res.json({ok:true,message:`Set ${setNo} started. Level 1 is open for all players.`});
});
app.post('/api/host/next-level',auth,host,async(req,res)=>{
 const s=await state(); if(!s.set_started||!s.results_approved)return res.status(400).json({error:'Approve the current level before advancing.'});
 const c=challenges[s.current_challenge]; if(c.challenge_number>=10)return res.status(400).json({error:'This set is complete. Select the next set and click START SET.'});
 const idx=s.current_challenge+1,ev=marketFor(idx); await pool.query("UPDATE game_state SET current_challenge=$1,submissions_locked=false,revealed=false,results_approved=false,market_event=$2 WHERE id=1",[idx,JSON.stringify(ev)]);res.json({ok:true,message:`Level ${c.challenge_number+1} opened for all players.`});
});
app.post('/api/host/open/:index',auth,host,async(req,res)=>{
 const i=Number(req.params.index); if(!Number.isInteger(i)||i<0||i>=challenges.length) return res.status(400).json({error:'Invalid challenge index.'});
 const s=await state();
 if(s.current_challenge!==i && s.current_challenge>=0 && s.status==='active' && !s.results_approved) return res.status(409).json({error:'Approve the current challenge results before moving on.'});
 const ev=marketFor(i); await pool.query("UPDATE game_state SET current_challenge=$1,current_set=$2,set_started=true,status='active',submissions_locked=false,revealed=false,results_approved=false,market_event=$3 WHERE id=1",[i,challenges[i].set_number,JSON.stringify(ev)]);
 res.json({ok:true});
});
app.post('/api/host/lock',auth,host,async(req,res)=>{
 await pool.query('UPDATE game_state SET submissions_locked=true WHERE id=1');res.json({ok:true});
});
app.post('/api/host/reveal',auth,host,async(req,res)=>{
 const s=await state(); if(!s.submissions_locked) return res.status(400).json({error:'Lock submissions before revealing.'});
 await pool.query('UPDATE game_state SET revealed=true WHERE id=1');res.json({ok:true});
});
app.post('/api/host/approve-results',auth,host,async(req,res)=>{
 const s=await state(); if(!s.revealed) return res.status(400).json({error:'Reveal decisions first.'});
 const c=challenges[s.current_challenge];
 const submissions=(await pool.query('SELECT * FROM submissions WHERE challenge_index=$1',[s.current_challenge])).rows;
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  for(const sub of submissions){
   const existing=await client.query('SELECT id FROM results WHERE player_id=$1 AND challenge_index=$2',[sub.player_id,s.current_challenge]);
   if(existing.rowCount) continue;
   const p=(await client.query('SELECT * FROM players WHERE id=$1 FOR UPDATE',[sub.player_id])).rows[0];
   if(!p||p.eliminated) continue;
   const opt=c.options.find(o=>o.key===sub.option_key); if(!opt) continue;
   const dec=sub.decision_data||{}, st=phaseById('strategy',dec.strategy),op=phaseById('operations',dec.operations),pr=phaseById('protection',dec.protection); if(!st||!op||!pr)continue;
   const intelCost=Number(sub.intelligence_cost||0),baseCost=Number(opt.cost)+st.cost+op.cost+pr.cost,totalCost=baseCost+intelCost; if(Number(p.balance)<baseCost)continue;
   const ks=p.kingdom_state||{}; const event=s.market_event||MARKET_EVENTS[0];
   const assetBonus=Math.min(0.35,Math.max(-0.20,(Number(ks.infrastructure||0)+Number(ks.trade_power||0)+Number(ks.food_reserve||0)+Number(ks.stability||0)+Number(ks.military_readiness||0))/100));
   const phaseBonus=(Number(st.stats.trade_power||0)+Number(op.stats.infrastructure||0)+Number(pr.stats.insurance||0))*0.012;
   const risk=Number(pr.risk||0); const exposure=(Number(event.multiplier||1)-1)*(1-risk)+assetBonus+phaseBonus;
   const gross=Math.round(Number(opt.revenue)*(1+exposure)); const net=gross-totalCost, newBalance=Math.max(0,Number(p.balance)+gross-baseCost);
   const quality=net>150000000?'Excellent':net>60000000?'Good':net>=0?'Acceptable':'Major Mistake'; const xp=XP[quality], crown=CROWN[quality];
   const nextKingdom=mergeStats({...ks},st.stats);mergeStats(nextKingdom,op.stats);mergeStats(nextKingdom,pr.stats);mergeStats(nextKingdom,event.effect);
   const eliminated=newBalance===0;
   await client.query('INSERT INTO results(player_id,challenge_index,option_key,cost,revenue,net,quality,xp_delta,crown_delta,balance_after) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [p.id,s.current_challenge,opt.key,totalCost,gross,net,quality,xp,crown,newBalance]);
   await client.query('UPDATE players SET balance=$1,xp=xp+$2,crown_points=crown_points+$3,eliminated=$4,kingdom_state=$5 WHERE id=$6',[newBalance,xp,crown,eliminated,JSON.stringify(nextKingdom),p.id]);
  }
  await client.query("UPDATE game_state SET results_approved=true,status=CASE WHEN current_challenge=99 THEN 'completed' ELSE status END WHERE id=1");
  await client.query('COMMIT'); res.json({ok:true,message:'Results calculated and approved once.'});
 }catch(e){await client.query('ROLLBACK');console.error(e);res.status(500).json({error:'Could not approve results.'});}
 finally{client.release();}
});
app.post('/api/host/reopen',auth,host,async(req,res)=>{
 await pool.query('UPDATE game_state SET submissions_locked=false,revealed=false WHERE id=1');res.json({ok:true});
});
app.post('/api/host/next-night',auth,host,async(req,res)=>{
 await pool.query('UPDATE game_state SET game_night=game_night+1,status=CASE WHEN current_challenge>=99 THEN status ELSE \'active\' END WHERE id=1');res.json({ok:true});
});
app.post('/api/host/reset',auth,host,async(req,res)=>{
 // Host button intentionally performs the reset immediately without a confirmation prompt.
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  // Clear player-related records and reset generated IDs atomically.
  await client.query('TRUNCATE TABLE results, submissions, intelligence_purchases, players RESTART IDENTITY');
  // Return the entire game to its original registration stage.
  await client.query(`
    INSERT INTO game_state(id,current_challenge,status,submissions_locked,revealed,results_approved,game_night,updated_at)
    VALUES(1,0,'registration',false,false,false,1,NOW())
    ON CONFLICT(id) DO UPDATE SET
      current_challenge=0,
      current_set=1,set_started=false,market_event='{}'::jsonb,
      status='registration',
      submissions_locked=false,
      revealed=false,
      results_approved=false,
      game_night=1,
      updated_at=NOW()
  `);
  await client.query('COMMIT');
  res.json({ok:true,message:'Full reset completed. All players, access codes, balances, submissions, results, scores, and game progress have been cleared.'});
 }catch(e){
  await client.query('ROLLBACK');
  console.error('FULL GAME RESET FAILED:',e);
  res.status(500).json({error:'Full reset failed. Check the Render logs for the reset error.'});
 }finally{client.release();}
});
app.get('/api/leaderboard',auth,async(req,res)=>{
 const q=await pool.query('SELECT name,balance,xp,crown_points,eliminated FROM players WHERE approved=true ORDER BY crown_points DESC,xp DESC,balance DESC');
 res.json({leaderboard:q.rows});
});
app.post('/api/submit',auth,async(req,res)=>{
 if(req.user.role!=='player') return res.status(403).json({error:'Player account required.'});
 const s=await state(),p=await playerSafe(req.user.id);
 if(!p?.approved) return res.status(403).json({error:'Player is not approved.'});
 if(p.eliminated||Number(p.balance)===0) return res.status(403).json({error:'You have been eliminated.'});
 if(s.status!=='active'||!s.set_started) return res.status(400).json({error:'The host has not started this set.'});
 if(s.submissions_locked||s.revealed||s.results_approved) return res.status(400).json({error:'Submissions are closed for this level.'});
 const idx=s.current_challenge,c=challenges[idx], key=String(req.body.option_key||''),opt=c.options.find(o=>o.key===key);
 if(!opt)return res.status(400).json({error:'Choose a valid core decision.'});
 const dec=req.body.decisions||{}; const strategy=phaseById('strategy',dec.strategy),operations=phaseById('operations',dec.operations),protection=phaseById('protection',dec.protection);
 if(!strategy||!operations||!protection)return res.status(400).json({error:'Complete all three strategic phases.'});
 const intelCost=Number(req.body.intelligence_cost||0); if(![0,5000000,15000000].includes(intelCost))return res.status(400).json({error:'Invalid intelligence tier.'});
 const totalCost=Number(opt.cost)+strategy.cost+operations.cost+protection.cost; // Intelligence was deducted at purchase time.
 if(Number(p.balance)<totalCost)return res.status(400).json({error:'Your treasury cannot cover the complete plan. Choose a less expensive combination.'});
 const decisionData={strategy:strategy.id,operations:operations.id,protection:protection.id};
 try{await pool.query('INSERT INTO submissions(player_id,challenge_index,option_key,decision_data,intelligence_cost) VALUES($1,$2,$3,$4,$5)',[req.user.id,idx,key,JSON.stringify(decisionData),intelCost]);res.json({ok:true,message:'Your complete royal plan is submitted privately.'});}
 catch(e){if(e.code==='23505')return res.status(409).json({error:'You have already submitted for this level.'});res.status(500).json({error:'Submission failed.'});}
});
// Optional intelligence purchase is a one-time purchase per player and level, before submitting.
app.post('/api/intelligence',auth,async(req,res)=>{
 if(req.user.role!=='player')return res.status(403).json({error:'Player account required.'});
 const tier=Number(req.body.tier),cost=tier===1?5000000:tier===2?15000000:0;
 if(!cost)return res.status(400).json({error:'Choose an available intelligence tier.'});
 const s=await state(),client=await pool.connect();
 try{await client.query('BEGIN');const p=(await client.query('SELECT * FROM players WHERE id=$1 FOR UPDATE',[req.user.id])).rows[0];
 if(!p?.approved||p.eliminated||Number(p.balance)<cost)throw new Error('Not enough available treasury for intelligence.');
 if(s.status!=='active'||s.submissions_locked||s.revealed||s.results_approved)throw new Error('Intelligence is only available while the level is open.');
 const already=await client.query('SELECT id FROM submissions WHERE player_id=$1 AND challenge_index=$2',[req.user.id,s.current_challenge]);if(already.rowCount)throw new Error('You already submitted this level.');
 const purchased=await client.query('SELECT id FROM intelligence_purchases WHERE player_id=$1 AND challenge_index=$2',[req.user.id,s.current_challenge]);if(purchased.rowCount)throw new Error('You already purchased intelligence for this level.');
 await client.query('UPDATE players SET balance=balance-$1 WHERE id=$2',[cost,req.user.id]);await client.query('INSERT INTO intelligence_purchases(player_id,challenge_index,cost,tier) VALUES($1,$2,$3,$4)',[req.user.id,s.current_challenge,cost,tier]);
 const event=s.market_event||MARKET_EVENTS[0];const clue=tier===1?`Advisers warn: ${event.hint} Your prior kingdom assets may matter.`:`Royal intelligence identifies a likely market pressure: ${event.title}. Hint: ${event.hint} This is useful intelligence, not a guaranteed outcome.`;
 await client.query('COMMIT');res.json({ok:true,cost,clue,balance:Number(p.balance)-cost});
 }catch(e){await client.query('ROLLBACK');res.status(400).json({error:e.message||'Intelligence purchase failed.'});}finally{client.release();}
});
app.get('/api/history',auth,async(req,res)=>{
 let q;
 if(req.user.role==='host') q=await pool.query('SELECT p.name,r.* FROM results r JOIN players p ON p.id=r.player_id ORDER BY r.challenge_index,r.created_at');
 else q=await pool.query('SELECT r.* FROM results r WHERE r.player_id=$1 ORDER BY r.challenge_index',[req.user.id]);
 res.json({history:q.rows});
});
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
init().then(()=>app.listen(PORT,()=>console.log('KINGMAKERS ARENA listening on '+PORT))).catch(e=>{console.error('DB init failed',e);process.exit(1);});
