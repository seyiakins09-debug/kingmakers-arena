
let token=null, role=null, me=null, challengeMeta=[], refreshTimer=null, pollBusy=false;
const SESSION_KEY='kingmakersArenaSession';
function saveSession(){if(token&&role)localStorage.setItem(SESSION_KEY,JSON.stringify({token,role}));}
function clearSession(){localStorage.removeItem(SESSION_KEY);token=null;role=null;me=null;}
const $=id=>document.getElementById(id);
const fmt=n=>'₦'+Number(n||0).toLocaleString('en-NG');
const num=n=>Number(n||0).toLocaleString('en-NG');
function msg(t,type='notice'){ $('message').innerHTML=`<div class="${type} notice">${t}</div>`;window.scrollTo({top:0,behavior:'smooth'});}
async function api(url,method='GET',body){
 const r=await fetch(url,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});
 const d=await r.json().catch(()=>({error:'Unexpected server response'}));if(!r.ok)throw new Error(d.error||'Request failed');return d;
}
function showAuth(tab='login'){ $('authView').classList.remove('hidden');$('playerView').classList.add('hidden');$('hostView').classList.add('hidden');$('loginForm').classList.toggle('hidden',tab!=='login');$('registerForm').classList.toggle('hidden',tab!=='register');$('hostForm').classList.toggle('hidden',tab!=='host');$('logoutBtn').style.display='none';}
function logged(){ $('authView').classList.add('hidden');$('logoutBtn').style.display='inline-block';}
$('loginTab').onclick=()=>showAuth('login');$('registerTab').onclick=()=>showAuth('register');$('hostTab').onclick=()=>showAuth('host');
$('loginForm').onsubmit=async e=>{e.preventDefault();try{const d=await api('/api/login','POST',Object.fromEntries(new FormData(e.target)));token=d.token;role='player';saveSession();await loadPlayer();}catch(x){msg(x.message,'error')}};
$('registerForm').onsubmit=async e=>{e.preventDefault();try{const d=await api('/api/register','POST',Object.fromEntries(new FormData(e.target)));msg(d.message,'success');e.target.reset();}catch(x){msg(x.message,'error')}};
$('hostForm').onsubmit=async e=>{e.preventDefault();try{const d=await api('/api/host/login','POST',Object.fromEntries(new FormData(e.target)));token=d.token;role='host';saveSession();logged();$('hostView').classList.remove('hidden');$('playerView').classList.add('hidden');await loadHost();}catch(x){msg(x.message,'error')}};
$('logoutBtn').onclick=()=>{clearSession();showAuth();msg('Signed out.');};
async function loadPlayer(){
 logged();$('playerView').classList.remove('hidden');$('hostView').classList.add('hidden');
 const d=await api('/api/game');me=d.player;$('playerWelcome').textContent='Welcome, '+me.name;
 $('pBalance').textContent=fmt(me.balance);$('pXP').textContent=num(me.xp);$('pCrown').textContent=num(me.crown_points);
 $('playerStatus').textContent=me.eliminated?'ELIMINATED':'ACTIVE';$('statusBadge').textContent='PLAYER';
 const box=$('playerChallenge');const previousChoice=box.querySelector('input[name=option_key]:checked')?.value;const c=d.current;
 if(!c){box.innerHTML='<h2 class="gold">Waiting for the Royal Host</h2><p>The host has not opened a challenge yet.</p>';}
 else{
  let html=`<span class="badge">SET ${c.set_number} • CHALLENGE ${c.challenge_number}</span><h2 class="gold">${c.title}</h2><p>${c.scenario}</p>`;
  if(me.eliminated) html+='<div class="notice error">Your treasury reached ₦0. You are eliminated and cannot submit more decisions.</div>';
  else if(d.state.results_approved) html+='<div class="notice success">Results have been approved. Check your Royal Journey for the result.</div>';
  else if(d.state.revealed) html+='<div class="notice">The Royal Host has revealed this challenge. Results are being reviewed.</div>';
  else if(d.state.submissions_locked) html+='<div class="notice">Submissions are locked. Await the host’s reveal.</div>';
  else if(d.submitted) html+=`<div class="notice success">Your decision (${d.submitted}) is submitted and locked privately. Waiting for the host.</div>`;
  else if(d.state.status!=='active') html+='<div class="notice">The challenge is not open for submissions yet.</div>';
  else{
   html+='<form id="decisionForm"><h3>Choose your royal decision</h3>';
   c.options.forEach(o=>{html+=`<label class="option"><input type="radio" name="option_key" value="${o.key}" required><div><strong>${o.key}. ${o.name}</strong><p>${o.description}</p><p>Required investment: <b>${fmt(o.cost)}</b></p></div></label>`});
   html+='<button>Submit Secret Decision</button></form><p class="muted small">Your choice is private and cannot be changed after submission unless the host reopens the round.</p>';
  }
  box.innerHTML=html;
  if(d.state.revealed || d.state.results_approved){
   const reveal=document.createElement('div');reveal.className='notice';
   reveal.innerHTML=`<h3 class="gold">Royal Reveal — Current Challenge</h3><p>${d.state.results_approved?'The host approved the results. Your treasury and scores have been updated.':'The host has revealed everyone’s decisions. Final balances and scoring will update after host approval.'}</p>`+
    (d.revealed_details?.length?`<div class="tablewrap"><table><tr><th>Player</th><th>Decision</th><th>Cost</th><th>Revenue</th><th>Net</th><th>Quality</th></tr>${d.revealed_details.map(r=>`<tr><td>${esc(r.name)}</td><td>${r.option_key}. ${esc(r.option_name)}</td><td>${fmt(r.cost)}</td><td>${fmt(r.revenue)}</td><td>${fmt(r.net)}</td><td>${esc(r.quality)}</td></tr>`).join('')}</table></div>`:'<p>No submitted decisions to reveal.</p>');
   box.appendChild(reveal);
  }
  const form=$('decisionForm');if(form&&previousChoice){const radio=form.querySelector(`input[name=option_key][value="${previousChoice}"]`);if(radio)radio.checked=true;}if(form)form.onsubmit=async e=>{e.preventDefault();try{await api('/api/submit','POST',Object.fromEntries(new FormData(e.target)));msg('Decision submitted successfully. It is hidden from other players.','success');await loadPlayer();}catch(x){msg(x.message,'error')}};
 }
 $('leaderboard').innerHTML=leaderHTML(d.leaderboard);
 const h=await api('/api/history');$('playerHistory').innerHTML=historyHTML(h.history,false);
}
function leaderHTML(rows){if(!rows.length)return '<p class="muted">No approved players yet.</p>';return `<div class="tablewrap"><table><tr><th>Rank / Player</th><th>Crown</th><th>XP</th><th>Treasury</th><th>Status</th></tr>${rows.map((p,i)=>`<tr><td>${i+1}. ${esc(p.name)}</td><td>${num(p.crown_points)}</td><td>${num(p.xp)}</td><td>${fmt(p.balance)}</td><td>${p.eliminated?'Eliminated':'Active'}</td></tr>`).join('')}</table></div>`}
function historyHTML(rows,host){if(!rows.length)return '<p class="muted">No approved results yet.</p>';return `<div class="tablewrap"><table><tr><th>Challenge</th>${host?'<th>Player</th>':''}<th>Choice</th><th>Cost</th><th>Revenue</th><th>Net</th><th>Quality</th><th>XP</th><th>Crown</th><th>Balance after</th></tr>${rows.map(r=>`<tr><td>${r.challenge_index+1}</td>${host?`<td>${esc(r.name)}</td>`:''}<td>${r.option_key}</td><td>${fmt(r.cost)}</td><td>${fmt(r.revenue)}</td><td>${fmt(r.net)}</td><td>${esc(r.quality)}</td><td>${num(r.xp_delta)}</td><td>${num(r.crown_delta)}</td><td>${fmt(r.balance_after)}</td></tr>`).join('')}</table></div>`}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
async function loadHost(){
 logged();$('hostView').classList.remove('hidden');$('playerView').classList.add('hidden');$('statusBadge').textContent='HOST';
 const d=await api('/api/host/dashboard'),s=d.state;
 $('hostState').textContent=`${s.status} • Night ${s.game_night} • ${s.submissions_locked?'Locked':'Open'} • ${s.revealed?'Revealed':''}`;
 $('challengeSelect').innerHTML=d.challenge_list.map((c,i)=>`<option value="${i}" ${i===s.current_challenge?'selected':''}>${String(i+1).padStart(2,'0')} — Set ${c.set_number}: ${c.title}</option>`).join('');
 $('pendingList').innerHTML=d.pending.length?d.pending.map(p=>`<div class="playerrow"><div><b>${esc(p.name)}</b><div class="muted small">Registration pending</div></div><div class="actions"><button onclick="approvePlayer(${p.id})">Approve</button><button class="danger" onclick="rejectPlayer(${p.id})">Reject</button></div></div>`).join(''):'<p class="muted">No pending requests.</p>';
 $('submissionList').innerHTML=d.submissions.length?`<table><tr><th>Player</th><th>Decision</th><th>Submitted</th></tr>${d.submissions.map(s=>`<tr><td>${esc(s.name)}</td><td>${s.option_key}</td><td>${new Date(s.submitted_at).toLocaleString()}</td></tr>`).join('')}</table>`:'<p class="muted">No submissions yet.</p>';
 $('hostPlayers').innerHTML=`<table><tr><th>Player</th><th>Approval</th><th>Treasury</th><th>XP</th><th>Crown</th><th>Status</th></tr>${d.players.map(p=>`<tr><td>${esc(p.name)}</td><td>${p.approved?'Approved':'Pending'}</td><td>${fmt(p.balance)}</td><td>${num(p.xp)}</td><td>${num(p.crown_points)}</td><td>${p.eliminated?'Eliminated':'Active'}</td></tr>`).join('')}</table>`;
 $('hostResults').innerHTML=s.revealed&&!s.results_approved ? `<h3 class="gold">Reveal Preview — Not Yet Applied</h3><table><tr><th>Player</th><th>Choice</th><th>Cost</th><th>Revenue</th><th>Net</th><th>Quality</th><th>XP</th><th>Crown</th><th>Balance after</th></tr>${d.preview.map(r=>`<tr><td>${esc(r.name)}</td><td>${r.option_key}</td><td>${fmt(r.cost)}</td><td>${fmt(r.revenue)}</td><td>${fmt(r.net)}</td><td>${esc(r.quality)}</td><td>${num(r.xp_delta)}</td><td>${num(r.crown_delta)}</td><td>${fmt(r.balance_after)}</td></tr>`).join('')}</table><p class="muted small">Preview only. Balances and scores update only after you approve.</p>` : historyHTML(d.results.map(r=>({...r,challenge_index:s.current_challenge})),true);
}
window.approvePlayer=async id=>{try{const d=await api('/api/host/approve/'+id,'POST');msg(`Approved ${esc(d.name)}. Give the player this permanent access code: <span class="code">${d.access_code}</span>`, 'success');await loadHost();}catch(e){msg(e.message,'error')}};
window.rejectPlayer=async id=>{try{await api('/api/host/reject/'+id,'POST');await loadHost();}catch(e){msg(e.message,'error')}};
$('startBtn').onclick=async()=>{try{await api('/api/host/start','POST');msg('Game is open.','success');await loadHost()}catch(e){msg(e.message,'error')}};
$('openChallengeBtn').onclick=async()=>{try{await api('/api/host/open/'+$('challengeSelect').value,'POST');msg('Challenge opened. Players can submit secret decisions.','success');await loadHost()}catch(e){msg(e.message,'error')}};
$('lockBtn').onclick=async()=>{try{await api('/api/host/lock','POST');msg('Submissions locked.','success');await loadHost()}catch(e){msg(e.message,'error')}};
$('revealBtn').onclick=async()=>{try{await api('/api/host/reveal','POST');msg('Decisions revealed to host.','success');await loadHost()}catch(e){msg(e.message,'error')}};
$('approveBtn').onclick=async()=>{if(!confirm('Approve this challenge and apply treasury, XP, and Crown Point changes?'))return;try{await api('/api/host/approve-results','POST');msg('Results approved and calculations applied once.','success');await loadHost()}catch(e){msg(e.message,'error')}};
$('reopenBtn').onclick=async()=>{try{await api('/api/host/reopen','POST');msg('Submissions reopened. Players may submit again.','success');await loadHost()}catch(e){msg(e.message,'error')}};
$('resetBtn').onclick=async()=>{const phrase=prompt('This permanently clears ALL players, access codes, balances, submissions, scores and resets the game. Type RESET KINGDOM to confirm:');if(phrase!=='RESET KINGDOM')return;try{await api('/api/host/reset','POST',{confirm:phrase});msg('Full reset completed. All player registrations and game data were cleared.','success');await loadHost()}catch(e){msg(e.message,'error')}};

// Live synchronization: refresh the dashboard/game state automatically while signed in.
// The session token is retained across page reloads; explicit Sign out clears it.
async function refreshCurrentView(){
 if(!token||!role||pollBusy||document.hidden)return;
 pollBusy=true;
 try{if(role==='host')await loadHost();else await loadPlayer();}
 catch(e){if(/session expired|sign in|invalid token/i.test(e.message)){clearSession();showAuth();msg('Your session expired. Please sign in again.','error');}}
 finally{pollBusy=false;}
}
function startLiveRefresh(){if(refreshTimer)clearInterval(refreshTimer);refreshTimer=setInterval(refreshCurrentView,3500);}
async function restoreSession(){
 try{const saved=JSON.parse(localStorage.getItem(SESSION_KEY)||'null');if(!saved?.token||!saved?.role)return;
  token=saved.token;role=saved.role;await api('/api/me');
  if(role==='host'){logged();$('hostView').classList.remove('hidden');$('playerView').classList.add('hidden');await loadHost();}
  else await loadPlayer();
 }catch(e){clearSession();showAuth();}
}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshCurrentView();});
startLiveRefresh();restoreSession();
