'use strict';
/*
  Scan & Review: zero-dependency server.
  Run: node server.js   (Node 18+)
  Env: PORT (default 3000), DATA_DIR (default ./data) -> point DATA_DIR at a persistent disk in production.
*/
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'data.json');

/* ---------- storage (JSON file, written atomically) ---------- */
fs.mkdirSync(DATA_DIR, { recursive: true });
let db = { businesses: {} }; // keyed by adminKey
try { db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) { /* first run */ }
function save() {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DATA_FILE);
}
function bySlug(slug) {
  for (const k in db.businesses) if (db.businesses[k].slug === slug) return db.businesses[k];
  return null;
}
const rid = (n) => crypto.randomBytes(n).toString('hex');
function slugify(name) {
  const base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'shop';
  let s;
  do { s = base + '-' + rid(2); } while (bySlug(s));
  return s;
}
function cleanUrl(u) {
  if (!u) return '';
  try { const x = new URL(String(u).trim()); return x.protocol === 'https:' ? x.toString() : ''; } catch (e) { return ''; }
}
const clip = (s, n) => String(s == null ? '' : s).trim().slice(0, n);
const REASONS = ['Long wait', 'Rude or cold staff', 'Poor quality', 'Too expensive', 'Not clean', 'Mistake with my order', 'Other'];
const TAGS = ['Friendly staff', 'Fast service', 'Great value', 'Spotless', 'Really skilled'];

/* ---------- tiny rate limiter ---------- */
const hits = new Map();
function limited(ip, bucket, max, windowMs) {
  const k = bucket + ':' + ip, now = Date.now();
  const arr = (hits.get(k) || []).filter((t) => now - t < windowMs);
  arr.push(now); hits.set(k, arr);
  return arr.length > max;
}
setInterval(() => hits.clear(), 3600 * 1000).unref();

/* ---------- http helpers ---------- */
function send(res, status, body, type) {
  res.writeHead(status, {
    'Content-Type': type || 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
  });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 20000) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

/* ---------- pages ---------- */
const CSS = `
:root{--bg:#eef2f1;--surface:#fff;--fg:#13211f;--muted:#5a6b68;--line:#d5dedc;--accent:#0b6b63;--accent-fg:#fff;--star:#f0a81a;--off:#cbd5d3;--bad:#b4491f;--good:#2e9e5b;--mid:#e0a800;--red:#d64545}
@media (prefers-color-scheme:dark){:root{--bg:#0d1716;--surface:#15221f;--fg:#e8f0ee;--muted:#93a7a3;--line:#27403b;--accent:#4fd1c0;--accent-fg:#06211d;--star:#f5b83a;--off:#3a4e4a;--bad:#f08a5d;--good:#4cc47f;--mid:#f2c230;--red:#ef6b6b;color-scheme:dark}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif;padding:24px 16px}
h1,h2{line-height:1.15;margin:0 0 10px}
.wrap{max-width:900px;margin:0 auto;display:grid;gap:22px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:20px;min-width:0}
.phone{max-width:420px;margin:0 auto}
label{display:block;font-size:.85rem;color:var(--muted);margin:12px 0 4px}
input,textarea{width:100%;font:inherit;color:var(--fg);background:var(--bg);border:1.5px solid var(--line);border-radius:10px;padding:10px 12px}
textarea{min-height:110px;resize:vertical}
button,.btn{font:inherit;cursor:pointer;background:var(--accent);color:var(--accent-fg);border:0;border-radius:999px;padding:12px 20px;font-weight:700;text-decoration:none;display:inline-block}
.ghost{background:transparent;color:var(--fg);border:1.5px solid var(--line)}
.row{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}
.muted{color:var(--muted);font-size:.9rem}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}
.stat{border:1px solid var(--line);border-radius:10px;padding:12px}
.stat b{display:block;font-size:1.8rem}
.stars{display:flex;gap:6px;justify-content:center;margin:18px 0}
.star{background:none;border:0;padding:4px;font-size:2.8rem;line-height:1;color:var(--off)}
.star.on{color:var(--star)}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chip{background:transparent;color:var(--fg);border:1.5px solid var(--line);padding:8px 14px}
.chip[aria-pressed=true]{background:var(--accent);color:var(--accent-fg);border-color:var(--accent)}
.reward{border:2px dashed var(--accent);border-radius:12px;padding:16px;text-align:center}
.code{font-size:2.2rem;font-weight:800;letter-spacing:.08em;display:block}
.qr{background:#fff;padding:14px;border-radius:8px;display:inline-block;line-height:0}
.list{display:grid;gap:8px}
.item{border:1px solid var(--line);border-radius:10px;padding:10px 12px;overflow-wrap:anywhere}
.ok{color:var(--accent)} .bad{color:var(--bad)}
[hidden]{display:none!important}
.rv{display:grid;grid-template-columns:minmax(0,300px) minmax(0,1fr);gap:20px;align-items:start}
@media (max-width:760px){.rv{grid-template-columns:minmax(0,1fr)}}
.panel{border:1px solid var(--line);border-radius:12px;padding:14px;display:grid;gap:8px;background:var(--surface);min-width:0}
.panel h3{font-size:1.05rem;margin:0}
.dist{display:grid;grid-template-columns:44px minmax(0,1fr) 28px;gap:8px;align-items:center;background:none;color:var(--fg);border:1.5px solid transparent;border-radius:8px;padding:5px 6px;width:100%;text-align:left;font-weight:400}
.dist[aria-pressed=true]{border-color:var(--accent)}
.bar{height:10px;border-radius:5px;background:var(--line);overflow:hidden}
.bar i{display:block;height:100%}
.dist.s5 .bar i,.dist.s4 .bar i{background:var(--good)}
.dist.s3 .bar i{background:var(--mid)}
.dist.s2 .bar i,.dist.s1 .bar i{background:var(--red)}
.dist span:last-child{text-align:right;color:var(--muted)}
.why{display:flex;flex-wrap:wrap;gap:6px}
.why .chip{padding:6px 11px;font-size:.88rem}
.toolbar{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin-bottom:10px}
select{font:inherit;color:var(--fg);background:var(--surface);border:1.5px solid var(--line);border-radius:8px;padding:6px 10px}
.rc{background:var(--surface);border:1px solid var(--line);border-radius:12px;margin-bottom:10px}
.rc>button{all:unset;box-sizing:border-box;width:100%;cursor:pointer;padding:12px 14px;display:grid;gap:4px}
.rc>button:focus-visible{outline:3px solid var(--accent);outline-offset:2px;border-radius:12px}
.rc .meta{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;font-size:.85rem;color:var(--muted)}
.rc .st{color:var(--star);letter-spacing:2px}.rc .st.low{color:var(--bad)}
.rc .prev{overflow-wrap:anywhere}
.rc .detail{padding:10px 14px 14px;display:grid;gap:8px;border-top:1px solid var(--line);overflow-wrap:anywhere}
.rtag{display:inline-block;border:1px solid var(--bad);color:var(--bad);border-radius:999px;padding:2px 10px;font-size:.8rem;margin:0 6px 4px 0}
.rtag.good{border-color:var(--accent);color:var(--accent)}
.sum-list{margin:0;padding-left:20px;display:grid;gap:8px}
.link{background:none;border:0;color:var(--muted);text-decoration:underline;padding:0;font-weight:400}
@media print{body{background:#fff;color:#000}.noprint{display:none!important}.card{border:2px solid #000}}
`;
const page = (title, body, script, head) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${CSS}</style>${head || ''}</head><body>${body}<script>${script}</script></body></html>`;

const LANDING = page('Scan & Review', `
<div class="wrap"><div class="card" style="max-width:520px;margin:0 auto;width:100%">
<h1>Get more reviews with a QR code</h1>
<p class="muted">Customers scan, rate, and get a reward. No app, no login. Set up in a minute.</p>
<form id="f">
<label for="name">Business name</label><input id="name" required maxlength="60" placeholder="Marisol's Barbershop">
<label for="reward">Reward for customers</label><input id="reward" maxlength="80" value="10% off your next visit">
<label for="g">Google review link (optional, you can add it later)</label><input id="g" placeholder="https://search.google.com/local/writereview?placeid=...">
<div class="row"><button type="submit">Create my QR code</button></div>
<p class="muted" id="err" role="alert"></p>
</form></div></div>`,
`document.getElementById('f').addEventListener('submit',function(e){
  e.preventDefault();
  fetch('/api/businesses',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
    name:document.getElementById('name').value,reward:document.getElementById('reward').value,googleUrl:document.getElementById('g').value})})
  .then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j}})})
  .then(function(x){ if(!x.ok){document.getElementById('err').textContent=x.j.error||'Something went wrong';return;}
    location.href='/admin/'+x.j.adminKey; })
  .catch(function(){document.getElementById('err').textContent='Network error. Try again.'});
});`);

const CUSTOMER = page('Leave feedback', `
<div class="phone card">
<div class="muted" id="biz">&nbsp;</div>
<div id="v-rate"><h1>How was your visit?</h1><p class="muted">Tap a star. It takes about 20 seconds.</p><div class="stars" id="stars"></div></div>
<div id="v-pub" hidden>
  <h1>Glad to hear it!</h1><p class="muted">What stood out? Tap any that fit.</p><div class="chips" id="chips"></div>
  <label for="draft">Your review (edit freely)</label><textarea id="draft"></textarea>
  <div class="row"><a class="btn" id="post" target="_blank" rel="noopener" hidden>Copy and post on Google</a><button class="ghost" id="skip">Continue</button></div>
</div>
<div id="v-priv" hidden>
  <h1>Sorry we missed the mark.</h1><p class="muted">Tell the owner what went wrong. They read every note.</p>
  <div class="muted" style="margin:12px 0 8px">What went wrong? Tap any that fit.</div><div class="chips" id="reasons"></div>
  <label for="ptext">Tell us more</label><textarea id="ptext"></textarea>
  <label for="pcontact">Email or phone (optional, if you want a reply)</label><input id="pcontact" maxlength="80">
  <div class="row"><button id="send">Send to the owner</button></div>
</div>
<div id="v-done" hidden><h1>Thank you!</h1><p class="muted">Show this at the counter.</p>
  <div class="reward"><span class="muted">Your code</span><span class="code" id="code"></span><b id="rw"></b></div>
  <p class="muted" id="dmsg"></p></div>
<p class="muted bad" id="err" role="alert"></p>
</div>`,
`(function(){
var slug=location.pathname.split('/').filter(Boolean)[1], rating=0, scanId=null, g='';
var $=function(i){return document.getElementById(i)};
var TAGS=['Friendly staff','Fast service','Great value','Spotless','Really skilled'], tags=[];
var REASONS=['Long wait','Rude or cold staff','Poor quality','Too expensive','Not clean','Mistake with my order','Other'];
function api(p,b){return fetch('/api/r/'+slug+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b||{})}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||'error');return j})})}
function show(id){['v-rate','v-pub','v-priv','v-done'].forEach(function(v){$(v).hidden=v!==id})}
function fail(e){$('err').textContent=e.message||'Something went wrong. Try again.'}
fetch('/api/public/'+slug).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error);return j})}).then(function(b){
  $('biz').textContent=b.name; document.title=b.name; g=b.googleUrl||'';
  if(g){$('post').hidden=false;$('post').href=g}
}).catch(function(){$('biz').textContent='This QR code is not active.';$('v-rate').hidden=true});
var st=$('stars');
for(var i=1;i<=5;i++)(function(n){var b=document.createElement('button');b.className='star';b.type='button';b.textContent='\\u2605';b.setAttribute('aria-label',n+' stars');
  b.onmouseenter=function(){paint(n)};b.onclick=function(){rating=n;paint(n);
    api('/rate',{rating:n}).then(function(j){scanId=j.scanId;if(n>=4){$('draft').value=compose();show('v-pub')}else show('v-priv')}).catch(fail)};
  st.appendChild(b)})(i);
st.onmouseleave=function(){paint(rating)};
function paint(n){for(var i=0;i<5;i++)st.children[i].classList.toggle('on',i<n)}
TAGS.forEach(function(t,idx){var c=document.createElement('button');c.className='chip';c.type='button';c.textContent=t;c.setAttribute('aria-pressed','false');
  c.onclick=function(){c.setAttribute('aria-pressed',c.getAttribute('aria-pressed')!=='true');
    tags=TAGS.filter(function(x,i){return $('chips').children[i].getAttribute('aria-pressed')==='true'});$('draft').value=compose()};
  $('chips').appendChild(c)});
function compose(){if(!tags.length)return rating+' stars. Great visit.';var l=tags.map(function(t){return t.toLowerCase()});var last=l.length>1?l.pop():null;return rating+' stars. '+(last?l.join(', ')+' and '+last:l[0])+'. I would come back.'}
function finish(msg){api('/finish',{scanId:scanId}).then(function(j){$('code').textContent=j.code;$('rw').textContent=j.reward;$('dmsg').textContent=msg||'';show('v-done')}).catch(fail)}
REASONS.forEach(function(t){var c=document.createElement('button');c.className='chip';c.type='button';c.textContent=t;c.setAttribute('aria-pressed','false');
  c.onclick=function(){c.setAttribute('aria-pressed',c.getAttribute('aria-pressed')!=='true')};$('reasons').appendChild(c)});
function pubFb(){return api('/feedback',{scanId:scanId,text:$('draft').value,tags:tags}).catch(function(){})}
$('post').onclick=function(){try{navigator.clipboard.writeText($('draft').value)}catch(e){}api('/google',{scanId:scanId}).catch(function(){});pubFb()};
$('skip').onclick=function(){pubFb().then(function(){finish('Thanks for stopping by.')})};
$('send').onclick=function(){var t=$('ptext').value.trim();
  var rs=REASONS.filter(function(x,i){return $('reasons').children[i].getAttribute('aria-pressed')==='true'});
  if(!t&&!rs.length){$('err').textContent='Please pick a reason or write a short note.';return}
  $('err').textContent='';
  api('/feedback',{scanId:scanId,text:t,reasons:rs,contact:$('pcontact').value}).then(function(){finish('Your note went to the owner only.')}).catch(fail)};
})();`);

const ADMIN = page('Owner dashboard', `
<div class="wrap">
<div class="card"><h1 id="title">Dashboard</h1><p class="muted">Bookmark this page. The link is your login. Anyone with it can manage this business, so don't share it.</p></div>
<div class="stats" id="stats"></div>
<div class="card" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:20px;align-items:center">
  <div style="text-align:center"><div class="qr" id="qr"></div></div>
  <div><h2>Your QR code</h2><p class="muted" id="link"></p>
  <div class="row noprint"><button id="print">Print table tent</button><a class="btn ghost" id="open" target="_blank" rel="noopener">Test it as a customer</a></div></div>
</div>
<div class="card noprint"><h2>Redeem a reward</h2>
  <div class="row" style="margin-top:0"><input id="rcode" placeholder="THX-AB12" style="max-width:220px;text-transform:uppercase"><button id="redeem">Redeem</button></div>
  <p id="rmsg" role="status"></p></div>
<div class="card noprint"><h2>Settings</h2>
  <label for="sname">Business name</label><input id="sname" maxlength="60">
  <label for="sreward">Reward</label><input id="sreward" maxlength="80">
  <label for="sg">Google review link</label><input id="sg" placeholder="https://search.google.com/local/writereview?placeid=...">
  <p class="muted">Find your Place ID with Google's Place ID Finder, then use https://search.google.com/local/writereview?placeid=YOUR_ID</p>
  <div class="row"><button id="savebtn">Save</button></div><p id="smsg" role="status"></p></div>
<div class="card noprint" id="summary" aria-live="polite"><h2>Low-rating summary</h2>
  <p class="muted">Auto-generated from all feedback of 3 stars or below. It updates as new feedback comes in.</p>
  <p id="sum-head" style="font-weight:600"></p><ol class="sum-list" id="sum-list"></ol><p id="sum-fix"></p></div>
<div class="card noprint"><h2>Customer reviews</h2>
  <div class="rv">
    <div style="display:grid;gap:14px;min-width:0">
      <div class="panel"><h3>By rating</h3><div id="dist"></div></div>
      <div class="panel"><h3>Why customers were unhappy</h3><p class="muted">From reviews of 3 stars or less. Tap a reason to filter.</p><div class="why" id="why"></div></div>
    </div>
    <div style="min-width:0">
      <div class="toolbar"><span class="muted" id="rv-count"></span>
        <span><label for="sort" style="display:inline">Sort </label><select id="sort"><option value="new">Newest first</option><option value="old">Oldest first</option><option value="low">Lowest rating first</option><option value="high">Highest rating first</option></select> <button class="link" id="clear" hidden>Clear filters</button></span></div>
      <div id="list"></div>
    </div>
  </div></div>
</div>`,
`(function(){
var key=location.pathname.split('/').filter(Boolean)[1], $=function(i){return document.getElementById(i)}, url='', qrmade=false;
function load(){fetch('/api/admin/'+key).then(function(r){if(!r.ok)throw 0;return r.json()}).then(render).catch(function(){document.body.innerHTML='<div class="wrap"><div class="card"><h1>Link not found</h1><p class="muted">Check that you copied the whole owner link.</p></div></div>'})}
function stat(n,l){return '<div class="stat"><b>'+n+'</b><span class="muted">'+l+'</span></div>'}
function render(d){
  $('title').textContent=d.name; document.title=d.name+' dashboard';
  var s=d.stats;
  $('stats').innerHTML=stat(s.scans,'Ratings')+stat(s.avg?s.avg.toFixed(1):'-','Average rating')+stat(s.google,'Sent to Google')+stat(s.rewards,'Rewards issued')+stat(s.redeemed,'Rewards redeemed')+stat(s.feedback,'Private notes');
  url=location.origin+'/r/'+d.slug; $('link').textContent=url; $('open').href=url;
  if(!qrmade&&window.QRCode){new QRCode($('qr'),{text:url,width:220,height:220,colorDark:'#000',colorLight:'#fff',correctLevel:QRCode.CorrectLevel.M});qrmade=true}
  else if(!window.QRCode){$('qr').textContent='QR library failed to load. Check your connection and refresh.'}
  if(document.activeElement.tagName!=='INPUT'){$('sname').value=d.name;$('sreward').value=d.reward;$('sg').value=d.googleUrl||''}
  REV=d.feedback; renderRev();
}
var REV=[], fStar=0, fWhy='', openIds={};
var TX={
 'Long wait':['Appointments ran late or customers waited with no explanation','Text customers when you run behind and leave a buffer between appointments.'],
 'Rude or cold staff':['Staff seemed distracted, dismissive or on their phones','Agree a simple greeting standard and keep phones away during a service.'],
 'Poor quality':['The work came out uneven or was not fixed when raised','Check the result with the customer before they leave and offer a free fix.'],
 'Too expensive':['The price felt high for what they got','Show prices clearly up front and explain what each service includes.'],
 'Not clean':['The shop or tools looked dirty','Add a short cleaning checklist between customers and at open and close.'],
 'Mistake with my order':['They did not get the style or service they asked for','Repeat the request back before starting.'],
 'Other':['Other issues such as noise or space','Read the written notes for details.']};
function starStr(n){return '\\u2605\\u2605\\u2605\\u2605\\u2605'.slice(0,n)+'\\u2606\\u2606\\u2606\\u2606\\u2606'.slice(0,5-n)}
function renderSummary(){
  var low=REV.filter(function(r){return r.rating<=3}), head=$('sum-head'), ol=$('sum-list'), fix=$('sum-fix');
  ol.innerHTML=''; fix.textContent='';
  if(!low.length){head.textContent='No feedback of 3 stars or below yet.';return}
  var sum=0; low.forEach(function(r){sum+=r.rating});
  head.textContent=low.length+' of '+REV.length+' reviews are 3 stars or below ('+Math.round(low.length/REV.length*100)+'%), averaging '+(sum/low.length).toFixed(1)+' stars.'+(low.length<5?' This is a small sample, so treat the patterns as early signals.':'');
  var rc={}; low.forEach(function(r){(r.reasons||[]).forEach(function(x){rc[x]=(rc[x]||0)+1})});
  var keys=Object.keys(rc).sort(function(a,b){return rc[b]-rc[a]});
  if(!keys.length){fix.textContent='No reasons were selected. Read the written notes below.';return}
  keys.slice(0,3).forEach(function(k){
    var li=document.createElement('li'), t=k+' ('+rc[k]+' of '+low.length+'): '+TX[k][0]+'.';
    if(k==='Long wait'){var nums=[];low.forEach(function(r){if((r.reasons||[]).indexOf(k)>-1){var m=(r.text||'').match(/(\\d+)\\s*minute/);if(m)nums.push(+m[1])}});
      if(nums.length){var lo=Math.min.apply(null,nums),hi=Math.max.apply(null,nums);t+=' Customers who gave times mention '+(lo===hi?'about '+lo:lo+' to '+hi)+' minutes.'}}
    li.textContent=t; ol.appendChild(li)});
  fix.textContent='Fix first: '+TX[keys[0]][1];
}
function renderRev(){
  renderSummary();
  var all=REV, counts=[0,0,0,0,0,0];
  all.forEach(function(r){counts[r.rating]++});
  var max=Math.max.apply(null,counts.slice(1))||1, d=$('dist'); d.innerHTML='';
  for(var s=5;s>=1;s--)(function(s){
    var b=document.createElement('button');b.type='button';b.className='dist s'+s;b.setAttribute('aria-pressed',fStar===s);b.setAttribute('aria-label',s+' star reviews: '+counts[s]);
    var a=document.createElement('span');a.textContent=s+' \\u2605';
    var bar=document.createElement('span');bar.className='bar';var f=document.createElement('i');f.style.width=(counts[s]/max*100)+'%';bar.appendChild(f);
    var n=document.createElement('span');n.textContent=counts[s];
    b.appendChild(a);b.appendChild(bar);b.appendChild(n);
    b.onclick=function(){fStar=(fStar===s?0:s);renderRev()};d.appendChild(b)})(s);
  var rc={};all.forEach(function(r){if(r.rating<=3)(r.reasons||[]).forEach(function(x){rc[x]=(rc[x]||0)+1})});
  var w=$('why');w.innerHTML='';
  Object.keys(rc).sort(function(a,b){return rc[b]-rc[a]}).forEach(function(k){
    var c=document.createElement('button');c.type='button';c.className='chip';c.textContent=k+' ('+rc[k]+')';c.setAttribute('aria-pressed',fWhy===k);
    c.onclick=function(){fWhy=(fWhy===k?'':k);renderRev()};w.appendChild(c)});
  var list=all.filter(function(r){return (!fStar||r.rating===fStar)&&(!fWhy||(r.reasons&&r.reasons.indexOf(fWhy)>-1))});
  var mode=$('sort').value;
  list.sort(function(a,b){
    if(mode==='low'&&a.rating!==b.rating)return a.rating-b.rating;
    if(mode==='high'&&a.rating!==b.rating)return b.rating-a.rating;
    return mode==='old'?a.at-b.at:b.at-a.at});
  $('rv-count').textContent=list.length+' of '+all.length+' reviews'+(fStar?' \\u00b7 '+fStar+' star':'')+(fWhy?' \\u00b7 '+fWhy:'');
  $('clear').hidden=!(fStar||fWhy);
  var L=$('list');L.innerHTML='';
  if(!list.length){L.innerHTML='<p class="muted">'+(all.length?'No reviews match these filters.':'No reviews yet. They appear here as customers scan and respond.')+'</p>';return}
  list.forEach(function(r){
    var card=document.createElement('div');card.className='rc';
    var btn=document.createElement('button');btn.type='button';btn.setAttribute('aria-expanded',!!openIds[r.scanId]);
    var meta=document.createElement('div');meta.className='meta';
    var st=document.createElement('span');st.className='st'+(r.rating<=3?' low':'');st.textContent=starStr(r.rating);st.setAttribute('aria-label',r.rating+' stars');
    var when=document.createElement('span');when.textContent=new Date(r.at).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
    meta.appendChild(st);meta.appendChild(when);
    var txt=r.text||'(No written comment.)';
    var prev=document.createElement('div');prev.className='prev';prev.textContent=txt.length>90?txt.slice(0,90)+'\\u2026':txt;
    btn.appendChild(meta);btn.appendChild(prev);
    var det=document.createElement('div');det.className='detail';det.hidden=!openIds[r.scanId];
    var full=document.createElement('p');full.style.margin='0';full.textContent=txt;det.appendChild(full);
    var tr=document.createElement('div');
    (r.reasons||[]).forEach(function(x){var t=document.createElement('span');t.className='rtag';t.textContent=x;tr.appendChild(t)});
    (r.tags||[]).forEach(function(x){var t=document.createElement('span');t.className='rtag good';t.textContent=x;tr.appendChild(t)});
    if(tr.children.length){var lab=document.createElement('div');lab.className='muted';lab.textContent=r.rating<=3?'Why they were unhappy':'What they liked';det.appendChild(lab);det.appendChild(tr)}
    if(r.contact){var c=document.createElement('div');c.className='muted';c.textContent='Contact: '+r.contact;det.appendChild(c)}
    var src=document.createElement('div');src.className='muted';src.textContent=r.rating<=3?'Private note to the owner':'Draft review text. This does not confirm it was posted on Google.';det.appendChild(src);
    btn.onclick=function(){var o=btn.getAttribute('aria-expanded')==='true';btn.setAttribute('aria-expanded',!o);det.hidden=o;openIds[r.scanId]=!o};
    card.appendChild(btn);card.appendChild(det);L.appendChild(card)});
}
$('sort').onchange=renderRev;
$('clear').onclick=function(){fStar=0;fWhy='';renderRev()};
function post(p,b){return fetch('/api/admin/'+key+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}).then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j}})})}
$('redeem').onclick=function(){post('/redeem',{code:$('rcode').value}).then(function(x){var m=$('rmsg');m.className=x.ok?'ok':'bad';m.textContent=x.ok?'Redeemed: '+x.j.reward:(x.j.error||'Failed');if(x.ok){$('rcode').value='';load()}})};
$('savebtn').onclick=function(){post('/settings',{name:$('sname').value,reward:$('sreward').value,googleUrl:$('sg').value}).then(function(x){var m=$('smsg');m.className=x.ok?'ok':'bad';m.textContent=x.ok?'Saved.':(x.j.error||'Failed');if(x.ok)load()})};
$('print').onclick=function(){window.print()};
window.addEventListener('load',load); setInterval(load,30000);
})();`,
'<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>');

/* ---------- routes ---------- */
const server = http.createServer(async (req, res) => {
  const ip = req.socket.remoteAddress || 'x';
  const u = new URL(req.url, 'http://x');
  const p = u.pathname.replace(/\/+$/, '') || '/';
  let m;
  try {
    if (req.method === 'GET') {
      if (p === '/') return send(res, 200, LANDING, 'text/html; charset=utf-8');
      if (/^\/r\/[a-z0-9-]+$/.test(p)) return send(res, 200, CUSTOMER, 'text/html; charset=utf-8');
      if (/^\/admin\/[a-f0-9]+$/.test(p)) return send(res, 200, ADMIN, 'text/html; charset=utf-8');
      if (p === '/healthz') return send(res, 200, { ok: true });
      if ((m = p.match(/^\/api\/public\/([a-z0-9-]+)$/))) {
        const b = bySlug(m[1]); if (!b) return send(res, 404, { error: 'not found' });
        return send(res, 200, { name: b.name, googleUrl: b.googleUrl });
      }
      if ((m = p.match(/^\/api\/admin\/([a-f0-9]+)$/))) {
        const b = db.businesses[m[1]]; if (!b) return send(res, 404, { error: 'not found' });
        const rated = b.scans.filter((s) => s.rating);
        return send(res, 200, {
          name: b.name, slug: b.slug, reward: b.reward, googleUrl: b.googleUrl,
          stats: {
            scans: rated.length,
            avg: rated.length ? rated.reduce((a, s) => a + s.rating, 0) / rated.length : 0,
            google: b.scans.filter((s) => s.google).length,
            rewards: b.rewards.length,
            redeemed: b.rewards.filter((r) => r.redeemedAt).length,
            feedback: b.feedback.filter((f) => f.rating <= 3).length,
          },
          feedback: b.feedback.slice(-500).reverse(),
        });
      }
      return send(res, 404, { error: 'not found' });
    }

    if (req.method === 'POST') {
      if (p === '/api/businesses') {
        if (limited(ip, 'create', 10, 3600 * 1000)) return send(res, 429, { error: 'Too many requests. Try later.' });
        const b = await readJson(req);
        const name = clip(b.name, 60); if (!name) return send(res, 400, { error: 'Business name is required.' });
        const adminKey = rid(16);
        db.businesses[adminKey] = {
          slug: slugify(name), name, reward: clip(b.reward, 80) || '10% off your next visit',
          googleUrl: cleanUrl(b.googleUrl), createdAt: Date.now(), scans: [], feedback: [], rewards: [],
        };
        save();
        return send(res, 200, { adminKey, slug: db.businesses[adminKey].slug });
      }
      if ((m = p.match(/^\/api\/r\/([a-z0-9-]+)\/(rate|feedback|google|finish)$/))) {
        if (limited(ip, 'cust', 60, 60 * 1000)) return send(res, 429, { error: 'Slow down a little.' });
        const biz = bySlug(m[1]); if (!biz) return send(res, 404, { error: 'not found' });
        const b = await readJson(req);
        if (m[2] === 'rate') {
          const rating = Math.round(Number(b.rating));
          if (!(rating >= 1 && rating <= 5)) return send(res, 400, { error: 'Invalid rating.' });
          const scan = { id: rid(8), rating, at: Date.now() };
          biz.scans.push(scan); save();
          return send(res, 200, { scanId: scan.id });
        }
        const scan = biz.scans.find((s) => s.id === b.scanId);
        if (!scan) return send(res, 400, { error: 'Start over by tapping a star.' });
        if (m[2] === 'google') { scan.google = true; save(); return send(res, 200, { ok: true }); }
        if (m[2] === 'feedback') {
          const text = clip(b.text, 1000);
          const reasons = (Array.isArray(b.reasons) ? b.reasons : []).filter((x) => REASONS.includes(x)).slice(0, 7);
          const tags = (Array.isArray(b.tags) ? b.tags : []).filter((x) => TAGS.includes(x)).slice(0, 5);
          if (scan.rating <= 3 && !text && !reasons.length) return send(res, 400, { error: 'Please pick a reason or write a note.' });
          if (!biz.feedback.some((f) => f.scanId === scan.id)) {
            biz.feedback.push({ scanId: scan.id, rating: scan.rating, text, reasons, tags, contact: clip(b.contact, 80), at: Date.now() });
            save();
          }
          return send(res, 200, { ok: true });
        }
        if (m[2] === 'finish') {
          let r = biz.rewards.find((x) => x.scanId === scan.id);
          if (!r) {
            let code;
            const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
            do { code = 'THX-'; for (let i = 0; i < 4; i++) code += A[crypto.randomInt(A.length)]; } while (biz.rewards.some((x) => x.code === code));
            r = { code, scanId: scan.id, issuedAt: Date.now() }; biz.rewards.push(r); save();
          }
          return send(res, 200, { code: r.code, reward: biz.reward });
        }
      }
      if ((m = p.match(/^\/api\/admin\/([a-f0-9]+)\/(redeem|settings)$/))) {
        if (limited(ip, 'admin', 60, 60 * 1000)) return send(res, 429, { error: 'Slow down a little.' });
        const biz = db.businesses[m[1]]; if (!biz) return send(res, 404, { error: 'not found' });
        const b = await readJson(req);
        if (m[2] === 'settings') {
          const name = clip(b.name, 60); if (!name) return send(res, 400, { error: 'Name is required.' });
          biz.name = name; biz.reward = clip(b.reward, 80) || biz.reward;
          const g = cleanUrl(b.googleUrl);
          if (b.googleUrl && !g) return send(res, 400, { error: 'Google link must start with https://' });
          biz.googleUrl = g; save();
          return send(res, 200, { ok: true });
        }
        const code = clip(b.code, 12).toUpperCase();
        const r = biz.rewards.find((x) => x.code === code);
        if (!r) return send(res, 404, { error: 'Code not found.' });
        if (r.redeemedAt) return send(res, 409, { error: 'Already redeemed on ' + new Date(r.redeemedAt).toLocaleString() + '.' });
        r.redeemedAt = Date.now(); save();
        return send(res, 200, { reward: biz.reward });
      }
    }
    return send(res, 404, { error: 'not found' });
  } catch (e) {
    return send(res, 400, { error: 'Bad request.' });
  }
});
server.listen(PORT, () => console.log('Scan & Review running on http://localhost:' + PORT));
