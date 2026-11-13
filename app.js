const $ = id => document.getElementById(id);
let sb, session, lastQuiz = null;

(async () => {
  fetch('/health').catch(() => {});                       // wake the server early
  const c = await (await fetch('/api/config')).json();
  sb = supabase.createClient(c.url, c.anon);
  const { data } = await sb.auth.getSession(); setSession(data.session);
  sb.auth.onAuthStateChange((_, s) => setSession(s));
})();

function setSession(s) {
  session = s; $('auth').hidden = !!s; $('out').hidden = !s;
  document.querySelectorAll('.tab').forEach(t => t.hidden = true);
  if (s) show('home');
}
function show(tab) {
  if (!session) return;
  document.querySelectorAll('.tab').forEach(t => t.hidden = t.id !== tab);
  document.querySelectorAll('nav [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  if (tab === 'history') loadHistory(); if (tab === 'quiz') renderQuiz();
}
document.querySelectorAll('nav [data-tab]').forEach(b => b.onclick = () => show(b.dataset.tab));
$('out').onclick = () => sb.auth.signOut();

async function auth(kind) {
  const f = kind === 'up' ? sb.auth.signUp : sb.auth.signInWithPassword;
  const { error } = await f.call(sb.auth, { email: $('em').value, password: $('pw').value });
  $('amsg').textContent = error ?  error.message : (kind === 'up' ? 'Account created! If asked, confirm your email, then sign in.' : '');
}
$('in').onclick = () => auth('in'); $('up').onclick = () => auth('up');

// resize image to ~1024px JPEG so each photo = one small, fast request
function compress(file) {
  return new Promise(res => {
    const img = new Image(); img.onload = () => {
      const s = Math.min(1, 1024 / Math.max(img.width, img.height)), cv = document.createElement('canvas');
      cv.width = img.width * s; cv.height = img.height * s; cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      const url = cv.toDataURL('image/jpeg', .8); $('prev').src = url; $('prev').hidden = false; res(url.split(',')[1]);
    }; img.src = URL.createObjectURL(file);
  });
}
async function ready() {                                   // handles Render cold start quietly
  for (let i = 0; i < 12; i++) { try { if ((await fetch('/health')).ok) return; } catch {} $('status').textContent = 'Getting Knowora ready…'; await new Promise(r => setTimeout(r, 4000)); }
}
let busy = false;
async function identify(body) {
  if (busy) return; busy = true; $('result').innerHTML = ''; $('status').textContent = 'Knowora is looking… 🔍';
  try {
    await ready();
    const r = await fetch('/api/identify', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token }, body: JSON.stringify({ ...body, lang: $('lang').value }) });
    const j = await r.json();
    $('status').textContent = j.soft || j.error ? (j.message || j.error) : '';
    if (j.result) render(j.result);
  } catch { $('status').textContent = 'Connection hiccup. Please tap once more.'; }
  busy = false;
}
['cam', 'up-file'].forEach(id => $(id).onchange = async e => { if (e.target.files[0]) identify({ image: await compress(e.target.files[0]) }); e.target.value = ''; });
$('go').onclick = () => { const t = $('q').value.trim(); if (t) { $('prev').hidden = true; identify({ text: t }); } };
$('q').onkeydown = e => e.key === 'Enter' && $('go').click();

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function render(r) {
  lastQuiz = r.quiz; const n = encodeURIComponent(r.name);
  const sec = (t, v) => v ? `<h3>${t}</h3><p>${esc(v)}</p>` : '';
  $('result').innerHTML = `<div class="card"><h2>${esc(r.name)}</h2><span class="tag">${esc(r.category)}</span>
  ${r.living === true ? '<span class="tag">Living</span>' : r.living === false ? '<span class="tag">Non-living</span>' : ''}
  ${r.scientificName ? `<span class="tag"><i>${esc(r.scientificName)}</i></span>` : ''}
  ${r.confidence ? `<span class="tag">${esc(r.confidence)}% sure</span>` : ''}
  <p>${esc(r.summary)}</p><button id="say">🔊 Listen</button>
  ${(r.details || []).map(d => sec(d.title, d.text)).join('')}
  ${sec('How it works / how to use', r.howItWorksOrUse)}
  ${r.funFacts?.length ? `<h3>Fun facts</h3><ul>${r.funFacts.map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
  ${sec('Approximate price', r.priceRange)}${sec('Where to find it', r.whereToFind)}${sec('Can it be bought?', r.purchaseNote)}
  ${r.conservation?.status ? `<h3>Conservation</h3><p><b>${esc(r.conservation.status)}</b> — ${esc(r.conservation.note)}</p>` : ''}
  ${r.similar?.length ? `<h3>Similar</h3>${r.similar.map(s => `<span class="tag">${esc(s)}</span>`).join('')}` : ''}
  ${r.priceRange && r.living !== true ? `<div class="row"><a class="btn" target="_blank" rel="noopener" href="https://www.google.com/search?tbm=shop&q=${n}">🛒 Google Shopping</a><a class="btn alt" target="_blank" rel="noopener" href="https://www.amazon.com/s?k=${n}">Amazon</a></div>` : ''}</div>`;
  $('say').onclick = () => { speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance(r.name + '. ' + r.summary)); };
}
async function loadHistory() {
  const j = await (await fetch('/api/history', { headers: { Authorization: 'Bearer ' + session.access_token } })).json();
  $('hlist').innerHTML = j.items.length ? '' : '<p class="msg">Nothing yet.</p>';
  j.items.forEach(i => { const d = document.createElement('div'); d.className = 'card'; d.innerHTML = `<b>${esc(i.name)}</b> <span class="tag">${esc(i.category)}</span>`; d.onclick = () => { show('home'); render(i.result); }; $('hlist').append(d); });
}
function renderQuiz() {
  const q = lastQuiz; if (!q) return;
  $('qbox').innerHTML = `<h3>${esc(q.question)}</h3>` + q.options.map((o, i) => `<button class="opt" data-i="${i}">${esc(o)}</button>`).join('') + '<p id="exp" class="msg"></p>';
  $('qbox').querySelectorAll('.opt').forEach(b => b.onclick = () => { const ok = +b.dataset.i === q.answerIndex; b.classList.add(ok ? 'good' : 'bad'); if (!ok) $('qbox').querySelector(`[data-i="${q.answerIndex}"]`).classList.add('good'); $('exp').textContent = q.explanation; });
}
