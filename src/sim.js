/**
 * Browser-based chat simulator.
 *
 * Drives the *real* flow.js state machine and renderer — the only things
 * swapped out are the two edges that need Meta: outgoing messages are captured
 * into an in-memory outbox, and uploaded image bytes are stashed instead of
 * downloaded from the Graph API. What you see here is what WhatsApp will do.
 *
 * Disable in production with SIMULATOR=off.
 */

import express from 'express';
import { config } from './config.js';
import { handleIncoming } from './flow.js';
import { stashMedia } from './media.js';
import { registerVirtualRecipient } from './whatsapp.js';
import { newId } from './store.js';

const outboxes = new Map(); // simId -> payload[]  (backlog, replayed on connect)
const listeners = new Map(); // simId -> Set<res>  (live SSE connections)

function ensureSim(simId) {
  if (outboxes.has(simId)) return outboxes.get(simId);

  const outbox = [];
  outboxes.set(simId, outbox);
  listeners.set(simId, new Set());

  registerVirtualRecipient(simId, (payload) => {
    outbox.push(payload);
    for (const res of listeners.get(simId)) {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    }
  });
  return outbox;
}

const isSimId = (value) => /^sim-[\w-]{4,40}$/.test(String(value || ''));

const contactFor = (simId) => ({ wa_id: simId, profile: { name: 'Simulator' } });

export function mountSimulator(app) {
  const sim = express.Router();
  sim.use(express.json({ limit: '30mb' }));

  sim.get('/', (_req, res) => res.type('html').send(simPage()));

  // Live stream of everything the bot sends. Backlog is replayed on connect, so
  // the conversation survives a page refresh.
  sim.get('/stream', (req, res) => {
    const simId = String(req.query.id || '');
    if (!isSimId(simId)) return res.status(400).json({ error: 'bad id' });

    const outbox = ensureSim(simId);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 1000\n\n');
    for (const payload of outbox) res.write(`data: ${JSON.stringify(payload)}\n\n`);

    const clients = listeners.get(simId);
    clients.add(res);

    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => {
      clearInterval(ping);
      clients.delete(res);
    });
  });

  // Same data, pull-style — handy for scripted tests (curl, CI).
  sim.get('/messages', (req, res) => {
    const simId = String(req.query.id || '');
    if (!isSimId(simId)) return res.status(400).json({ error: 'bad id' });

    const outbox = ensureSim(simId);
    const cursor = Number(req.query.cursor || 0);
    res.json({ cursor: outbox.length, messages: outbox.slice(cursor) });
  });

  // Agent typed something, or tapped a reply button.
  sim.post('/send', async (req, res) => {
    const { id: simId, type, text, actionId } = req.body || {};
    if (!isSimId(simId)) return res.status(400).json({ error: 'bad id' });
    ensureSim(simId);

    const base = { id: `sim.${newId(4)}`, from: simId, timestamp: String(Date.now()) };
    const msg =
      type === 'action'
        ? { ...base, kind: 'action', actionId: String(actionId || '') }
        : { ...base, kind: 'text', text: String(text || '').trim() };

    if (msg.kind === 'text' && !msg.text) return res.status(400).json({ error: 'empty' });

    await handleIncoming(msg, contactFor(simId));
    res.json({ ok: true });
  });

  // Agent attached photos. Sent one flow message per image, exactly like WhatsApp.
  sim.post('/upload', async (req, res) => {
    const { id: simId, images } = req.body || {};
    if (!isSimId(simId)) return res.status(400).json({ error: 'bad id' });
    if (!Array.isArray(images) || !images.length) return res.status(400).json({ error: 'no images' });
    ensureSim(simId);

    const ids = [];
    for (const image of images.slice(0, config.maxImages)) {
      const buffer = Buffer.from(String(image.data || '').split(',').pop(), 'base64');
      if (!buffer.length) continue;

      const mediaId = `sim-${newId(6)}`;
      stashMedia(mediaId, { buffer, mimeType: image.mime || 'image/jpeg' });
      ids.push(mediaId);

      await handleIncoming(
        {
          id: `sim.${newId(4)}`,
          from: simId,
          kind: 'image',
          mediaId,
          mimeType: image.mime || 'image/jpeg',
          timestamp: String(Date.now()),
        },
        contactFor(simId),
      );
    }

    res.json({ ok: true, count: ids.length });
  });

  app.use('/sim', sim);
}

// ---------------------------------------------------------------- the page

const SAMPLE_EN = `Sea-view apartment in Marassi North Coast
Location: Marassi, Sidi Abdel Rahman
Price: 12.5M EGP
Area: 185 m²
Bedrooms: 3
Bathrooms: 3
Floor: 4
Finishing: Fully finished
View: Direct lagoon view
Delivery: Q3 2026
Payment: 10% down payment, 8 years installments
Prime location steps from the beach club
Private underground parking included`;

const SAMPLE_AR = `شقة للبيع في كمبوند بالم هيلز
الموقع: بالم هيلز، أكتوبر
السعر: 8.4 مليون جنيه
المساحة: 165 متر
الغرف: 3
الحمامات: 2
الدور: الثاني
التشطيب: سوبر لوكس
التسليم: فوري
التقسيط: مقدم 20% وتقسيط على 6 سنوات
قريبة من النادي والمنطقة التجارية`;

function simPage() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Simulator · ${escapeHtml(config.brand.name)}</title>
<style>
  *,*::before,*::after{box-sizing:border-box}
  :root{
    --bg:#0b0d10; --panel:#111418; --chat:#0f1317; --in:#1f242b; --out:#12503f;
    --text:#e9edf2; --muted:#8b95a3; --line:rgba(255,255,255,.09); --accent:#25d366;
  }
  html,body{height:100%;margin:0}
  body{
    background:var(--bg);color:var(--text);
    font-family:"Segoe UI",system-ui,-apple-system,"Noto Sans Arabic",sans-serif;
    display:grid;grid-template-columns:minmax(0,1fr) 320px;height:100dvh;
  }
  @media (max-width:860px){body{grid-template-columns:1fr;grid-template-rows:1fr auto}.side{display:none}}

  .phone{display:flex;flex-direction:column;min-width:0;border-inline-end:1px solid var(--line)}
  header{
    display:flex;align-items:center;gap:12px;padding:12px 16px;
    background:var(--panel);border-bottom:1px solid var(--line)
  }
  .avatar{width:38px;height:38px;border-radius:50%;background:var(--accent);color:#04150d;
    display:grid;place-items:center;font-weight:700}
  header h1{font-size:.98rem;margin:0;font-weight:600}
  header small{color:var(--muted);font-size:.76rem}
  header .spacer{flex:1}
  .ghost{
    background:transparent;border:1px solid var(--line);color:var(--muted);
    border-radius:8px;padding:6px 12px;font:inherit;font-size:.8rem;cursor:pointer
  }
  .ghost:hover{color:var(--text);border-color:var(--muted)}

  .chat{flex:1;overflow-y:auto;padding:18px 16px 8px;display:flex;flex-direction:column;gap:8px;background:var(--chat)}
  .row{display:flex;max-width:76%}
  .row.out{align-self:flex-end;justify-content:flex-end}
  .row.in{align-self:flex-start}
  .bubble{
    padding:9px 13px;border-radius:14px;line-height:1.5;font-size:.93rem;
    white-space:pre-wrap;overflow-wrap:anywhere;
  }
  .in .bubble{background:var(--in);border-end-start-radius:4px}
  .out .bubble{background:var(--out);border-end-end-radius:4px}
  .bubble a{color:#8fe3ff}
  .bubble img{max-width:190px;border-radius:10px;display:block}
  .btns{display:flex;flex-direction:column;gap:6px;margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,.12)}
  .btns button{
    background:transparent;border:none;color:#53bdeb;font:inherit;font-weight:600;
    padding:7px;border-radius:8px;cursor:pointer;text-align:center
  }
  .btns button:hover{background:rgba(83,189,235,.12)}
  .btns button:disabled{color:var(--muted);cursor:default;background:transparent}
  .sys{align-self:center;color:var(--muted);font-size:.75rem;padding:4px 10px;background:rgba(255,255,255,.05);border-radius:99px}
  .thumbs{display:flex;flex-wrap:wrap;gap:5px;max-width:200px}
  .thumbs img{width:62px;height:62px;object-fit:cover;border-radius:8px}

  .composer{display:flex;gap:8px;padding:12px;background:var(--panel);border-top:1px solid var(--line);align-items:flex-end}
  .composer textarea{
    flex:1;resize:none;min-height:42px;max-height:150px;background:var(--in);color:var(--text);
    border:1px solid var(--line);border-radius:12px;padding:11px 13px;font:inherit;font-size:.93rem
  }
  .composer textarea:focus{outline:1px solid var(--accent)}
  .icon{
    width:42px;height:42px;flex:none;border-radius:50%;border:1px solid var(--line);
    background:var(--in);color:var(--text);font-size:1.15rem;cursor:pointer;display:grid;place-items:center
  }
  .icon.send{background:var(--accent);border-color:var(--accent);color:#04150d}

  .side{padding:20px 18px;overflow-y:auto;background:var(--panel)}
  .side h2{font-size:.78rem;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin:0 0 10px}
  .side section{margin-bottom:26px}
  .side p{color:var(--muted);font-size:.84rem;line-height:1.6;margin:0 0 10px}
  .side ol{color:var(--muted);font-size:.84rem;line-height:1.7;padding-inline-start:18px;margin:0}
  .chip{
    display:block;width:100%;text-align:start;background:var(--in);border:1px solid var(--line);
    color:var(--text);border-radius:10px;padding:9px 12px;font:inherit;font-size:.84rem;cursor:pointer;margin-bottom:7px
  }
  .chip:hover{border-color:var(--accent)}
  .links a{
    display:block;background:var(--in);border:1px solid var(--line);border-radius:10px;
    padding:9px 12px;font-size:.82rem;color:#8fe3ff;text-decoration:none;margin-bottom:7px;
    overflow:hidden;text-overflow:ellipsis;white-space:nowrap
  }
  .links a:hover{border-color:var(--accent)}
</style>
</head>
<body>
<div class="phone">
  <header>
    <div class="avatar">${escapeHtml((config.brand.name || 'R').trim().charAt(0).toUpperCase())}</div>
    <div>
      <h1>${escapeHtml(config.brand.name)}</h1>
      <small id="status">simulator · not connected to WhatsApp</small>
    </div>
    <div class="spacer"></div>
    <button class="ghost" id="reset" type="button">New chat</button>
  </header>

  <div class="chat" id="chat"></div>

  <div class="composer">
    <button class="icon" id="attach" type="button" title="Attach photos">📎</button>
    <textarea id="input" rows="1" placeholder="Type a message…"></textarea>
    <button class="icon send" id="send" type="button" title="Send">➤</button>
    <input type="file" id="file" accept="image/*" multiple hidden>
  </div>
</div>

<aside class="side">
  <section>
    <h2>How to test</h2>
    <ol>
      <li>Say hi to start.</li>
      <li>Attach a few photos 📎</li>
      <li>Tap <strong>Done</strong> (or wait ${Math.round(config.batchIdleMs / 1000)}s).</li>
      <li>Paste the listing details.</li>
      <li>Answer the floor-plan question.</li>
      <li>Open the link the bot sends.</li>
    </ol>
  </section>

  <section>
    <h2>Sample details</h2>
    <button class="chip" data-fill="en">📋 Paste English listing</button>
    <button class="chip" data-fill="ar">📋 Paste Arabic listing</button>
    <p>Arabic input switches the bot's replies and flips the presentation to RTL.</p>
  </section>

  <section>
    <h2>Presentations</h2>
    <div class="links" id="links"></div>
    <p id="noLinks">Links the bot sends will collect here.</p>
  </section>
</aside>

<script>
const SAMPLES = ${JSON.stringify({ en: SAMPLE_EN, ar: SAMPLE_AR })};
const chat = document.getElementById('chat');
const input = document.getElementById('input');
const file = document.getElementById('file');
const links = document.getElementById('links');

let simId = localStorage.getItem('simId');
if (!simId) { simId = 'sim-' + Math.random().toString(36).slice(2, 10); localStorage.setItem('simId', simId); }
let stream = null;

function scroll(){ chat.scrollTop = chat.scrollHeight; }

function bubble(side, build){
  const row = document.createElement('div');
  row.className = 'row ' + side;
  const b = document.createElement('div');
  b.className = 'bubble';
  if (/[\\u0600-\\u06FF]/.test(build.text || '')) b.dir = 'rtl';
  build(b);
  row.appendChild(b);
  chat.appendChild(row);
  scroll();
  return b;
}

function linkify(text){
  const frag = document.createDocumentFragment();
  const re = /(https?:\\/\\/[^\\s]+)/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    frag.append(text.slice(last, m.index));
    const a = document.createElement('a');
    a.href = m[1]; a.target = '_blank'; a.rel = 'noopener'; a.textContent = m[1];
    frag.append(a);
    last = m.index + m[1].length;
    addLink(m[1]);
  }
  frag.append(text.slice(last));
  return frag;
}

const seenLinks = new Set();
function addLink(url){
  if (seenLinks.has(url)) return;
  seenLinks.add(url);
  document.getElementById('noLinks').style.display = 'none';
  const a = document.createElement('a');
  a.href = url; a.target = '_blank'; a.rel = 'noopener';
  a.textContent = '🔗 ' + url.replace(/^https?:\\/\\//, '');
  links.prepend(a);
}

function botMessage(payload){
  const isInteractive = payload.type === 'interactive';
  const text = isInteractive ? payload.interactive.body.text : (payload.text?.body || '');

  const row = document.createElement('div');
  row.className = 'row in';
  const b = document.createElement('div');
  b.className = 'bubble';
  if (/[\\u0600-\\u06FF]/.test(text)) b.dir = 'rtl';
  b.appendChild(linkify(text));

  if (isInteractive) {
    const wrap = document.createElement('div');
    wrap.className = 'btns';
    for (const btn of payload.interactive.action.buttons) {
      const el = document.createElement('button');
      el.type = 'button';
      el.textContent = btn.reply.title;
      el.addEventListener('click', () => {
        wrap.querySelectorAll('button').forEach((x) => { x.disabled = true; });
        userText(btn.reply.title);
        post('/sim/send', { id: simId, type: 'action', actionId: btn.reply.id });
      });
      wrap.appendChild(el);
    }
    b.appendChild(wrap);
  }

  row.appendChild(b);
  chat.appendChild(row);
  scroll();
}

function userText(text){
  bubble('out', (b) => { b.textContent = text; });
}

function system(text){
  const el = document.createElement('div');
  el.className = 'sys';
  el.textContent = text;
  chat.appendChild(el);
  scroll();
}

async function post(url, body){
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) system('⚠️ ' + res.status + ' ' + (await res.text()).slice(0, 120));
  } catch (err) {
    system('⚠️ ' + err.message);
  }
}

const statusEl = document.getElementById('status');

function connect(){
  if (stream) stream.close();
  stream = new EventSource('/sim/stream?id=' + encodeURIComponent(simId));
  stream.onmessage = (e) => {
    try { botMessage(JSON.parse(e.data)); }
    catch (err) { system('⚠️ could not render a bot message: ' + err.message); }
  };
  stream.onopen = () => { statusEl.textContent = 'simulator · connected'; };
  stream.onerror = () => { statusEl.textContent = 'simulator · reconnecting…'; };
}

document.getElementById('send').addEventListener('click', sendText);
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText(); }
});
input.addEventListener('input', () => {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 150) + 'px';
});

function sendText(){
  const text = input.value.trim();
  if (!text) return;
  userText(text);
  input.value = '';
  input.style.height = 'auto';
  post('/sim/send', { id: simId, type: 'text', text });
}

document.getElementById('attach').addEventListener('click', () => file.click());
file.addEventListener('change', async () => {
  const files = [...file.files];
  file.value = '';
  if (!files.length) return;

  const images = [];
  for (const f of files) {
    const data = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(f);
    });
    images.push({ name: f.name, mime: f.type || 'image/jpeg', data });
  }

  bubble('out', (b) => {
    const wrap = document.createElement('div');
    wrap.className = 'thumbs';
    for (const img of images) {
      const el = document.createElement('img');
      el.src = img.data;
      wrap.appendChild(el);
    }
    b.appendChild(wrap);
  });

  system(images.length + ' photo' + (images.length > 1 ? 's' : '') + ' sent');
  await post('/sim/upload', { id: simId, images });
});

document.querySelectorAll('[data-fill]').forEach((btn) => {
  btn.addEventListener('click', () => {
    input.value = SAMPLES[btn.dataset.fill];
    input.dispatchEvent(new Event('input'));
    input.focus();
  });
});

document.getElementById('reset').addEventListener('click', () => {
  simId = 'sim-' + Math.random().toString(36).slice(2, 10);
  localStorage.setItem('simId', simId);
  chat.innerHTML = '';
  seenLinks.clear();
  links.innerHTML = '';
  document.getElementById('noLinks').style.display = '';
  system('New chat — say hi to start');
  connect();
});

system('Say hi to start');
connect();
</script>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
