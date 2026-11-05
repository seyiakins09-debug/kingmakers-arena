
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

async function init(){
 await pool.query(`
 CREATE TABLE IF NOT EXISTS players(
  id SERIAL PRIMARY KEY, name TEXT NOT NULL, name_key TEXT UNIQUE NOT NULL,
  access_hash TEXT, approved BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW(),
  balance BIGINT NOT NULL DEFAULT ${STARTING_BALANCE}, xp BIGINT NOT NULL DEFAULT 0,
  crown_points BIGINT NOT NULL DEFAULT 0, eliminated BOOLEAN NOT NULL DEFAULT false
 );
 CREATE TABLE IF NOT EXISTS game_state(
  id INTEGER PRIMARY KEY CHECK(id=1), current_challenge INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'registration', submissions_locked BOOLEAN NOT NULL DEFAULT false,
  revealed BOOLEAN NOT NULL DEFAULT false, results_approved BOOLEAN NOT NULL DEFAULT false,
  game_night INTEGER NOT NULL DEFAULT 1, updated_at TIMESTAMPTZ DEFAULT NOW()
 );
 INSERT INTO game_state(id) VALUES(1) ON CONFLICT DO NOTHING;
 CREATE TABLE IF NOT EXISTS submissions(
  id SERIAL PRIMARY KEY, player_id INTEGER REFERENCES players(id) ON DELETE CASCADE,
  challenge_index INTEGER NOT NULL, option_key TEXT NOT NULL, submitted_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(player_id,challenge_index)
 );
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
async function playerSafe(id){return (await pool.query('SELECT id,name,approved,balance,xp,crown_points,eliminated FROM players WHERE id=$1',[id])).rows[0];}
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
    options:c.options.map(o=>({key:o.key,name:o.name,description:o.description,cost:o.cost}))};
 }
 let player=null, submitted=null, revealed_details=[];
 if(req.user.role==='player'){
  player=await playerSafe(req.user.id);
  const sub=await pool.query('SELECT option_key FROM submissions WHERE player_id=$1 AND challenge_index=$2',[req.user.id,s.current_challenge]);
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
 const players=(await pool.query('SELECT id,name,approved,balance,xp,crown_points,eliminated FROM players ORDER BY approved DESC,name')).rows;
 const subs=(await pool.query(`SELECT p.name,s.option_key,s.challenge_index,s.submitted_at FROM submissions s JOIN players p ON p.id=s.player_id WHERE s.challenge_index=$1 ORDER BY p.name`,[s.current_challenge])).rows;
 const results=(await pool.query(`SELECT p.name,r.option_key,r.cost,r.revenue,r.net,r.quality,r.xp_delta,r.crown_delta,r.balance_after FROM results r JOIN players p ON p.id=r.player_id WHERE r.challenge_index=$1 ORDER BY p.name`,[s.current_challenge])).rows;
 const preview = s.revealed ? subs.map(sub=>{
  const ch=challenges[s.current_challenge], opt=ch.options.find(o=>o.key===sub.option_key);
  const pl=players.find(p=>p.name===sub.name);
  return opt ? {name:sub.name,option_key:opt.key,cost:opt.cost,revenue:opt.revenue,net:opt.revenue-opt.cost,quality:opt.quality,xp_delta:XP[opt.quality],crown_delta:CROWN[opt.quality],balance_before:pl?pl.balance:null,balance_after:pl?Number(pl.balance)+opt.revenue-opt.cost:null} : null;
}).filter(Boolean) : [];
res.json({state:s,players,pending:players.filter(p=>!p.approved),submissions:subs,results,preview,current:challenges[s.current_challenge]||null,challenge_count:challenges.length,challenge_list:challenges.map(c=>({set_number:c.set_number,set_name:c.set_name,challenge_number:c.challenge_number,title:c.title}))});
});
app.post('/api/host/start',auth,host,async(req,res)=>{
 await pool.query("UPDATE game_state SET status='active',submissions_locked=false,revealed=false,results_approved=false WHERE id=1");
 res.json({ok:true});
});
app.post('/api/host/open/:index',auth,host,async(req,res)=>{
 const i=Number(req.params.index); if(!Number.isInteger(i)||i<0||i>=challenges.length) return res.status(400).json({error:'Invalid challenge index.'});
 const s=await state();
 if(s.current_challenge!==i && s.current_challenge>=0 && s.status==='active' && !s.results_approved) return res.status(409).json({error:'Approve the current challenge results before moving on.'});
 await pool.query("UPDATE game_state SET current_challenge=$1,status='active',submissions_locked=false,revealed=false,results_approved=false WHERE id=1",[i]);
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
   if(Number(p.balance)<opt.cost) continue;
   const net=opt.revenue-opt.cost, newBalance=Number(p.balance)+net;
   const xp=XP[opt.quality], crown=CROWN[opt.quality];
   const eliminated=newBalance===0;
   await client.query('INSERT INTO results(player_id,challenge_index,option_key,cost,revenue,net,quality,xp_delta,crown_delta,balance_after) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [p.id,s.current_challenge,opt.key,opt.cost,opt.revenue,net,opt.quality,xp,crown,newBalance]);
   await client.query('UPDATE players SET balance=$1,xp=xp+$2,crown_points=crown_points+$3,eliminated=$4 WHERE id=$5',[newBalance,xp,crown,eliminated,p.id]);
  }
  await client.query('UPDATE game_state SET results_approved=true WHERE id=1');
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
 const confirm=String(req.body.confirm||'');
 if(confirm!=='RESET KINGDOM') return res.status(400).json({error:'Type RESET KINGDOM to confirm.'});
 const client=await pool.connect();
 try{await client.query('BEGIN');await client.query('DELETE FROM results');await client.query('DELETE FROM submissions');await client.query('DELETE FROM players');await client.query("UPDATE game_state SET current_challenge=0,status='registration',submissions_locked=false,revealed=false,results_approved=false,game_night=1 WHERE id=1");await client.query('COMMIT');res.json({ok:true,message:'Full reset complete. All player registrations, codes, balances, submissions and scores were cleared.'});}
 catch(e){await client.query('ROLLBACK');res.status(500).json({error:'Reset failed.'});}finally{client.release();}
});
app.get('/api/leaderboard',auth,async(req,res)=>{
 const q=await pool.query('SELECT name,balance,xp,crown_points,eliminated FROM players WHERE approved=true ORDER BY crown_points DESC,xp DESC,balance DESC');
 res.json({leaderboard:q.rows});
});
app.post('/api/submit',auth,async(req,res)=>{
 if(req.user.role!=='player') return res.status(403).json({error:'Player account required.'});
 const s=await state(); const p=await playerSafe(req.user.id);
 if(!p?.approved) return res.status(403).json({error:'Player is not approved.'});
 if(p.eliminated||Number(p.balance)===0) return res.status(403).json({error:'You have been eliminated.'});
 if(s.status!=='active') return res.status(400).json({error:'The host has not opened the game.'});
 if(s.submissions_locked) return res.status(400).json({error:'Submissions are locked.'});
 if(s.revealed||s.results_approved) return res.status(400).json({error:'This challenge has already been revealed.'});
 const idx=s.current_challenge, c=challenges[idx], key=String(req.body.option_key||'');
 const opt=c.options.find(o=>o.key===key); if(!opt) return res.status(400).json({error:'Choose a valid option.'});
 if(Number(p.balance)<opt.cost) return res.status(400).json({error:'Insufficient treasury funds for this option.'});
 try{await pool.query('INSERT INTO submissions(player_id,challenge_index,option_key) VALUES($1,$2,$3)',[req.user.id,idx,key]);res.json({ok:true,message:'Decision submitted and locked privately.'});}
 catch(e){if(e.code==='23505')return res.status(409).json({error:'You have already submitted for this challenge.'});res.status(500).json({error:'Submission failed.'});}
});
app.get('/api/history',auth,async(req,res)=>{
 let q;
 if(req.user.role==='host') q=await pool.query('SELECT p.name,r.* FROM results r JOIN players p ON p.id=r.player_id ORDER BY r.challenge_index,r.created_at');
 else q=await pool.query('SELECT r.* FROM results r WHERE r.player_id=$1 ORDER BY r.challenge_index',[req.user.id]);
 res.json({history:q.rows});
});
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
init().then(()=>app.listen(PORT,()=>console.log('KINGMAKERS ARENA listening on '+PORT))).catch(e=>{console.error('DB init failed',e);process.exit(1);});
