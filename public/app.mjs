// The tab page: start a tab (host), claim and pay (friends), and the host's panel.
import { HOST, SLACK, compute, people as peopleOf, itemsTotal, tidyName, slotsOf } from './split.mjs';

const API = '/api/tab';
const LIVE = 'https://tabsplitterns.netlify.app';
const PALETTE = ['#2F5BD3', '#0E8A5C', '#C2410C', '#7C3AED', '#0E7490', '#BE185D', '#4D7C0F', '#A16207', '#4338CA', '#0F766E', '#9D174D', '#475569'];
const $ = (s) => document.querySelector(s);
const app = $('#app');

/* ---------- Small helpers ---------- */
const fmt = (c) => (c < 0 ? '−' : '') + '$' + (Math.abs(Math.round(c)) / 100).toFixed(2);
const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const initial = (n) => (Array.from(String(n).trim())[0] || '?').toUpperCase();
const pc = (p) => PALETTE[((p && p.color) || 0) % PALETTE.length];
const av = (p, cls = '') => `<span class="av ${cls}" style="--pc:${pc(p)}" aria-hidden="true">${esc(initial(p.name))}</span>`;
const toCents = (v) => { const n = Number(String(v).replace(/[$,\s]/g, '')); return Number.isFinite(n) ? Math.round(n * 100) : NaN; };
const dollars = (c) => (c == null || Number.isNaN(c) ? '' : (c / 100).toFixed(2));
function setHTML(el, html) { if (el._h !== html) { el._h = html; el.innerHTML = html; } }
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
};
let toastT;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 3000);
}
const CHECK = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/* ---------- Where we are ---------- */
const m = location.pathname.match(/^\/t\/([a-z0-9]{10})\/?$/);
let tabId = m ? m[1] : new URLSearchParams(location.search).get('t');
if (tabId && !/^[a-z0-9]{10}$/.test(tabId)) tabId = null;
if (tabId && location.hash.startsWith('#h=')) {
  store.set('tab-host:' + tabId, location.hash.slice(3));
  history.replaceState(null, '', location.pathname + location.search);
}
let hostKey = tabId ? store.get('tab-host:' + tabId) : null;
let isHost = false;
let me = tabId ? store.get('tab-me:' + tabId) : null;
const linkPerson = new URLSearchParams(location.search).get('p');

let DEVICE = store.get('tab-device');
if (!DEVICE || !/^[a-z0-9]{4,24}$/.test(DEVICE)) { DEVICE = Math.random().toString(36).slice(2, 12).padEnd(10, '0'); store.set('tab-device', DEVICE); }

/* ---------- Talking to the server ---------- */
function body(extra) { return Object.assign({ t: tabId, device: DEVICE, actor: me || undefined, key: hostKey || undefined }, extra); }
async function post(b) {
  const r = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b), keepalive: true });
  let d = {};
  try { d = await r.json(); } catch (e) { /* empty */ }
  if (!r.ok) { const err = new Error(d.error || 'Couldn’t save that. Check your connection.'); err.status = r.status; throw err; }
  online(true);
  return d;
}
function beacon(extra) {
  const text = JSON.stringify(body(extra));
  try { if (navigator.sendBeacon && navigator.sendBeacon(API, new Blob([text], { type: 'text/plain' }))) return; } catch (e) { /* fall through */ }
  fetch(API, { method: 'POST', body: text, keepalive: true }).catch(() => {});
}
const track = (type, extra) => beacon(Object.assign({ op: 'event', type }, extra));
function online(ok) { $('#netbar').hidden = ok; }

/* ======================================================================
   Starting a tab
   ====================================================================== */
const profile = (() => { try { return JSON.parse(store.get('tab-profile') || '{}'); } catch (e) { return {}; } })();
const S = { step: 'photo', title: '', items: [], charge: '', receipt: null, check: null, scan: null, busy: false, hostName: profile.name || '', venmo: profile.venmo || '', people: [], mode: 'items' };

function renderStart() {
  $('#title').textContent = 'Split a tab';
  $('#subtitle').textContent = '';
  $('#meBtn').hidden = true;
  $('#dock').hidden = true;
  if (S.step === 'photo') {
    app.innerHTML = `
      <h1>Split a tab</h1>
      <p class="lede">Snap the receipt. Everyone taps what they had and pays you back on Venmo, with tax and tip worked out.</p>
      <div class="stack">
        <label class="btn wide" for="photo">Take a photo of the receipt</label>
        <input id="photo" type="file" accept="image/*" class="sr">
        <button type="button" class="btn ghost wide" data-act="type">Type the items instead</button>
      </div>
      <p id="scanStatus" class="note" role="status" aria-live="polite">${S.busy ? '<span class="spin"></span> Reading the receipt…' : ''}</p>`;
    $('#photo').addEventListener('change', (e) => { const f = e.target.files && e.target.files[0]; if (f) scanPhoto(f); });
    return;
  }
  if (S.step === 'review') return renderReview();
  if (S.step === 'people') return renderPeople();
}

async function shrink(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const s = Math.min(1, 1568 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.85).split(',')[1]; // re-encoding drops the photo's location data
  } finally { URL.revokeObjectURL(url); }
}

async function scanPhoto(file) {
  S.busy = true; renderStart();
  try {
    const image = await shrink(file);
    const r = await fetch('/api/scan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ image }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Couldn’t read that receipt.');
    const rc = d.receipt || {};
    S.receipt = rc; S.check = d.check; S.scan = d.model;
    S.title = rc.merchant || '';
    S.items = (rc.items || []).map((it) => ({ name: tidyName(it.name || '', it.quantity || 1), qty: it.quantity || 1, price: dollars(Math.round((it.price || 0) * 100)) }));
    S.charge = dollars(d.charge);
    S.step = 'review';
  } catch (e) {
    toast(e.message + ' You can type the items instead.');
  } finally { S.busy = false; renderStart(); }
}

function reviewNumbers() {
  const sum = S.items.reduce((s, it) => s + (toCents(it.price) || 0), 0);
  const rc = S.receipt;
  const inSub = rc && Array.isArray(rc.fees) ? rc.fees.filter((f) => f.listed_with_items).reduce((s, f) => s + Math.round(f.amount * 100), 0) : 0;
  const printed = rc ? Math.round(((rc.subtotal ?? rc.total) || 0) * 100) : null;
  return { sum, printed, inSub, charge: toCents(S.charge) };
}
function reviewStatus() {
  const n = reviewNumbers();
  const parts = [];
  if (n.printed) {
    const diff = n.printed - n.inSub - n.sum;
    if (Math.abs(diff) < 1) parts.push(`<p class="banner ok">The items add up to the receipt’s ${fmt(n.printed)} subtotal.</p>`);
    else parts.push(`<p class="banner warn">The items add up to ${fmt(n.sum + n.inSub)}, but the receipt says ${fmt(n.printed)}. Check the lines against the photo.</p>`);
  }
  if (Number.isFinite(n.charge) && n.charge > 0) {
    if (n.charge < n.sum) parts.push(`<p class="banner warn">The card charge is less than the items. Check it.</p>`);
    else parts.push(`<p class="note money">Tax, fees and tip: ${fmt(n.charge - n.sum)}, split by what each person had.</p>`);
  }
  return parts.join('');
}
function renderReview() {
  const rc = S.receipt || {};
  const notes = [];
  if (rc.gratuity) notes.push(`This receipt already includes a ${fmt(Math.round(rc.gratuity * 100))} gratuity, so no extra tip is needed.`);
  if (rc.tip && rc.tip_included_in_total === false) notes.push(`Includes the ${fmt(Math.round(rc.tip * 100))} tip written below the total.`);
  if (rc.card_charge == null && rc.total != null && !rc.tip) notes.push('If you added a tip when you paid, include it.');
  app.innerHTML = `
    <h1>Check the receipt</h1>
    <p class="lede">${S.receipt ? 'Fix anything that doesn’t match the paper.' : 'Add each line from the receipt.'}</p>
    <label class="f" for="tTitle">Name this tab</label>
    <input id="tTitle" class="in" value="${esc(S.title)}" placeholder="Friday dinner" maxlength="60" autocomplete="off">
    <h2>Items</h2>
    <div class="ie-head" aria-hidden="true"><span>Item</span><span>Qty</span><span>Line total</span><span></span></div>
    <div class="items-edit" id="itemsEdit">${S.items.map(itemRow).join('')}</div>
    <button type="button" class="link" data-act="addline">+ Add a line</button>
    <label class="f" for="charge">What your card was charged, with tip</label>
    <input id="charge" class="in money" inputmode="decimal" value="${esc(S.charge)}" placeholder="0.00" autocomplete="off">
    ${notes.map((n) => `<p class="note">${esc(n)}</p>`).join('')}
    <div id="reviewStatus" role="status" aria-live="polite" style="margin-top:12px">${reviewStatus()}</div>
    <div class="sh-foot"><button type="button" class="btn wide" data-act="toPeople">Next: who was there</button>
    <button type="button" class="btn ghost wide" data-act="restart">Start over</button></div>`;
}
const itemRow = (it, k) => `<div class="ie" data-k="${k}">
  <input class="in" data-f="name" aria-label="Item ${k + 1} name" value="${esc(it.name)}" maxlength="60" autocomplete="off">
  <input class="in" data-f="qty" aria-label="Item ${k + 1} quantity" inputmode="numeric" value="${esc(it.qty)}">
  <input class="in money" data-f="price" aria-label="Item ${k + 1} line total in dollars" inputmode="decimal" value="${esc(it.price)}" placeholder="0.00">
  <button type="button" class="x" data-act="delline" data-k="${k}" aria-label="Remove item ${k + 1}">×</button></div>`;

function renderPeople() {
  app.innerHTML = `
    <h1>Who was there?</h1>
    <p class="lede">Add everyone now, including anyone who already left. You can add items for them later.</p>
    <div class="row2">
      <div><label class="f" for="hostName">Your name</label><input id="hostName" class="in" value="${esc(S.hostName)}" maxlength="24" autocomplete="given-name"></div>
      <div><label class="f" for="venmo">Your Venmo username</label><input id="venmo" class="in" value="${esc(S.venmo)}" placeholder="@username" autocapitalize="off" autocorrect="off" maxlength="41"></div>
    </div>
    <label class="f" for="addName">Everyone else</label>
    <form id="addForm" class="row2" autocomplete="off"><input id="addName" class="in" placeholder="Name" maxlength="24" enterkeyhint="done"><button class="btn" type="submit" style="flex:0 0 auto">Add</button></form>
    <div class="chips" id="chips">${S.people.map((n, k) => `<span class="chip">${esc(n)}<button type="button" data-act="delname" data-k="${k}" aria-label="Remove ${esc(n)}">×</button></span>`).join('')}</div>
    <h2>How to split</h2>
    <label class="choice"><input type="radio" name="mode" value="items" ${S.mode === 'items' ? 'checked' : ''}><span><b>Everyone taps what they had</b><span>Best when people ordered different things.</span></span></label>
    <label class="choice"><input type="radio" name="mode" value="even" ${S.mode === 'even' ? 'checked' : ''}><span><b>Split evenly, minus what people skipped</b><span>Best for big groups and shared plates. People untick what they didn’t have.</span></span></label>
    <div class="sh-foot"><button type="button" class="btn wide" data-act="create">Create the tab</button>
    <button type="button" class="btn ghost wide" data-act="back">Back to the receipt</button></div>`;
  $('#addForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const n = $('#addName').value.replace(/\s+/g, ' ').trim();
    if (!n) return;
    if (!S.people.some((x) => x.toLowerCase() === n.toLowerCase())) S.people.push(n);
    S.hostName = $('#hostName').value; S.venmo = $('#venmo').value;
    renderPeople(); $('#addName').focus();
  });
}

app.addEventListener('input', (e) => {
  if (tabId) return;
  const row = e.target.closest('.ie');
  if (row) { S.items[Number(row.dataset.k)][e.target.dataset.f] = e.target.value; setHTML($('#reviewStatus'), reviewStatus()); return; }
  if (e.target.id === 'charge') { S.charge = e.target.value; setHTML($('#reviewStatus'), reviewStatus()); }
  if (e.target.id === 'tTitle') S.title = e.target.value;
  if (e.target.id === 'hostName') S.hostName = e.target.value;
  if (e.target.id === 'venmo') S.venmo = e.target.value;
  if (e.target.name === 'mode') S.mode = e.target.value;
});
app.addEventListener('change', (e) => { if (!tabId && e.target.name === 'mode') S.mode = e.target.value; });

function validItems() {
  const out = [];
  for (const [k, it] of S.items.entries()) {
    if (!it.name.trim() && !it.price) continue;
    const cents = toCents(it.price), qty = Number(it.qty || 1);
    if (!it.name.trim()) throw new Error(`Line ${k + 1} needs a name`);
    if (!Number.isInteger(cents) || cents < 0) throw new Error(`Check the price on line ${k + 1}`);
    if (!Number.isInteger(qty) || qty < 1) throw new Error(`Check the quantity on line ${k + 1}`);
    out.push({ name: it.name.trim(), qty, cents });
  }
  if (!out.length) throw new Error('Add at least one item');
  return out;
}

async function createTab() {
  let items;
  try { items = validItems(); } catch (e) { toast(e.message); return; }
  const charge = toCents(S.charge);
  if (!Number.isInteger(charge) || charge <= 0) { toast('Enter what your card was charged'); S.step = 'review'; renderStart(); return; }
  if (!S.hostName.trim()) { toast('Enter your name'); $('#hostName').focus(); return; }
  const btn = app.querySelector('[data-act="create"]'); btn.disabled = true;
  try {
    const title = S.title.trim() || `Tab · ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
    const d = await post({ op: 'create', title, hostName: S.hostName.trim(), venmo: S.venmo.trim(), items, charge, people: S.people, mode: S.mode, device: DEVICE, scan: S.scan || 'typed' });
    store.set('tab-profile', JSON.stringify({ name: S.hostName.trim(), venmo: S.venmo.trim() }));
    tabId = d.id; hostKey = d.hostKey; me = HOST; isHost = true;
    store.set('tab-host:' + tabId, hostKey); store.set('tab-me:' + tabId, HOST);
    history.pushState(null, '', '/t/' + tabId);
    T = d.state; view = 'people';
    renderAll(); poll();
    openSheet({ type: 'created' });
  } catch (e) { toast(e.message); btn.disabled = false; }
}

app.addEventListener('click', (e) => {
  if (tabId) return;
  const b = e.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act;
  if (a === 'type') { S.step = 'review'; S.receipt = null; S.scan = null; if (!S.items.length) S.items = [{ name: '', qty: 1, price: '' }, { name: '', qty: 1, price: '' }]; renderStart(); app.querySelector('.ie input').focus(); }
  if (a === 'addline') { S.items.push({ name: '', qty: 1, price: '' }); renderStart(); const ins = app.querySelectorAll('.ie'); ins[ins.length - 1].querySelector('input').focus(); }
  if (a === 'delline') { S.items.splice(Number(b.dataset.k), 1); renderStart(); }
  if (a === 'toPeople') { try { validItems(); } catch (err) { toast(err.message); return; } const c = toCents(S.charge); if (!Number.isInteger(c) || c <= 0) { toast('Enter what your card was charged'); $('#charge').focus(); return; } S.step = 'people'; renderStart(); window.scrollTo(0, 0); }
  if (a === 'back') { S.step = 'review'; renderStart(); }
  if (a === 'restart') { Object.assign(S, { step: 'photo', items: [], charge: '', receipt: null, check: null, scan: null, title: '' }); renderStart(); }
  if (a === 'delname') { S.people.splice(Number(b.dataset.k), 1); renderPeople(); }
  if (a === 'create') createTab();
});

/* ======================================================================
   A tab
   ====================================================================== */
let T = null;
let view = 'items';
let editFor = null; // the host is editing this person's items
const pend = new Map(); // even split: "item|person" -> 1 (in) or 0 (out), not yet saved
let pendOps = []; // itemized: slot changes not yet saved, in order
const openPeople = new Set();
const openCards = new Set(); // person cards the viewer has expanded
let sheet = null;
let lastActivity = Date.now();
let payReturn = null; // { amt } while someone is off in Venmo

function units(i, p) {
  const k = i + '|' + p;
  if (pend.has(k)) return pend.get(k);
  return T.out && T.out[i] && T.out[i][p] ? 0 : 1;
}
const isOut = (i, p) => units(i, p) === 0;
// The tab as this phone sees it: saved slots plus taps that haven't synced yet.
function viewT() {
  if (!pendOps.length || T.mode === 'even') return T;
  const slots = {};
  for (const it of T.items) slots[it.id] = slotsOf(T, it).map((x) => x.slice());
  for (const c of pendOps) {
    const sl = slots[c.i]; if (!sl) continue;
    if (c.a === 'take') { const k = sl.findIndex((x) => !x.length); if (k >= 0) sl[k] = [c.p]; }
    if (c.a === 'join' && sl[c.k] && !sl[c.k].includes(c.p)) sl[c.k].push(c.p);
    if (c.a === 'leave' && sl[c.k]) sl[c.k] = sl[c.k].filter((x) => x !== c.p);
  }
  return Object.assign({}, T, { slots });
}
const slotsNow = (it) => slotsOf(viewT(), it);
const count = (it, p) => (T.mode === 'even' ? units(it.id, p) : slotsNow(it).filter((x) => x.includes(p)).length);
const people = () => peopleOf(T);
const compute_ = () => compute(viewT(), { isOut });
const nameOf = (p) => (T.people[p] ? T.people[p].name : 'Someone');
function personalLink(p) { return `${location.origin}/t/${tabId}?p=${p}`; }
function venmoUrl(c) {
  const note = encodeURIComponent(T.title || 'Tab');
  return `https://venmo.com/${encodeURIComponent(T.payer.venmo)}?txn=pay&amount=${(Math.round(c) / 100).toFixed(2)}&note=${note}&audience=private`;
}

function accept(st) {
  if (!st || typeof st.rev !== 'number') return;
  if (T && st.rev < T.rev) return;
  st.items = (st.items || []).map((it) => Object.assign({}, it, { name: tidyName(it.name, it.qty) }));
  T = st;
  if (me && !T.people[me]) { me = null; store.set('tab-me:' + tabId, null); toast('You’re no longer on this tab. Pick your name again.'); }
  renderAll();
}

let flushT = null, flushing = false;
function scheduleFlush(ms = 250) { clearTimeout(flushT); flushT = setTimeout(flush, ms); }
async function flush() {
  if (flushing) { scheduleFlush(150); return; }
  if (!pend.size && !pendOps.length) return;
  flushing = true;
  try {
    if (pendOps.length) {
      const sent = pendOps.slice();
      const r = await post(body({ op: 'slots', changes: sent }));
      pendOps = pendOps.slice(sent.length);
      accept(r.state);
    }
    if (pend.size) {
      const changes = [...pend].map(([k, u]) => { const [i, p] = k.split('|'); return { i, p, u }; });
      const r = await post(body({ op: 'claims', changes }));
      changes.forEach((c) => { const k = c.i + '|' + c.p; if (pend.get(k) === c.u) pend.delete(k); });
      accept(r.state);
    }
  } catch (e) {
    if (e.status >= 400 && e.status < 500 && e.status !== 409) { pend.clear(); pendOps = []; toast(e.message); await poll(true); }
    else { if (e.status !== 409) online(false); scheduleFlush(e.status === 409 ? 400 : 3000); }
  } finally { flushing = false; }
}
async function act(b, okMsg) {
  try { const r = await post(body(b)); accept(r.state); if (okMsg) toast(okMsg); return r; } catch (e) { toast(e.message); poll(true); return null; }
}

let pollT = null, polling = false;
function schedulePoll() {
  clearTimeout(pollT);
  if (document.hidden || !T) return;
  const C = compute_();
  const mine = me && C.byId[me];
  const settledMe = me && me !== HOST && mine && mine.settled;
  const busy = Date.now() - lastActivity < 180000;
  const ms = T.closed ? 60000 : settledMe ? 60000 : busy ? 3000 : 15000;
  pollT = setTimeout(() => poll(), ms);
}
async function poll(full) {
  if (polling && !full) return;
  polling = true;
  try {
    const r = await fetch(`${API}?t=${tabId}` + (T && !full ? `&rev=${T.rev}` : ''), { cache: 'no-store' });
    const d = await r.json().catch(() => ({}));
    if (r.status === 404) {
      if (hostKey && !T) {
        // A tab started on a preview: bring it over once, using the host key.
        try { const m = await post({ op: 'import', t: tabId, key: hostKey }); isHost = true; me = HOST; store.set('tab-me:' + tabId, HOST); view = 'people'; accept(m.state); toast('Your tab is on the live site now. Share the new link.'); return; } catch (e) { /* not importable */ }
      }
      renderMissing(d.error); return;
    }
    if (!r.ok) throw new Error(String(r.status));
    online(true);
    if (!d.same) accept(d);
  } catch (e) {
    online(false);
    if (!T) app.innerHTML = '<p class="muted" role="status">Can’t load the tab. Check your connection; it will keep trying.</p>';
  } finally { polling = false; schedulePoll(); }
}
function renderMissing(msg) {
  app.innerHTML = `<h1>Tab not found</h1><p class="lede">${esc(msg || 'Check the link.')}</p><a class="btn" href="/">Start a new tab</a>`;
  $('#dock').hidden = true;
}

/* ---------- Rendering a tab ---------- */
function renderAll() {
  if (!tabId) return renderStart();
  if (!T) return;
  if (!me && linkPerson && T.people[linkPerson]) setMe(linkPerson, true);
  const C = compute_();
  $('#title').textContent = T.title || 'Tab';
  $('#subtitle').textContent = `${fmt(T.charge)} · paid by ${T.payer.name}${T.closed ? ' · closed' : ''}`;
  const mp = me && T.people[me];
  document.documentElement.style.setProperty('--me', mp ? pc(mp) : PALETTE[0]);
  const btn = $('#meBtn');
  btn.hidden = !mp;
  if (mp) setHTML(btn, `${av(mp)}<span class="nm">${esc(mp.name)}${isHost ? ' (host)' : ''}</span>`);
  if (!mp) { renderJoin(); $('#dock').hidden = true; if (sheet) closeSheet(); return; }
  let html = '';
  if (T.closed) html += `<p class="banner ok">This tab is closed. Thanks, everyone.</p>`;
  html += `<div class="seg" role="tablist" aria-label="View">
      <button type="button" role="tab" data-act="view" data-v="people" aria-selected="${view === 'people'}">People</button>
      <button type="button" role="tab" data-act="view" data-v="items" aria-selected="${view === 'items'}">Items</button></div>`;
  html += view === 'people' ? peoplePanel(C) : itemsList(C);
  setHTML(app, html);
  renderDock(C);
  if (sheet) renderSheet(C);
}

function renderJoin() {
  const list = people().filter((p) => p.id !== HOST || isHost);
  setHTML(app, `
    <h1>Who are you?</h1>
    <p class="lede">${esc(T.payer.name)} paid ${fmt(T.charge)}. Tap your name, then pick what you had.</p>
    <div class="names">${list.map((p) => `<button type="button" class="name-btn" data-act="pick" data-p="${p.id}">${av(p, 'lg')}<span>${esc(p.name)}</span></button>`).join('')}</div>
    ${T.closed ? '' : `<form id="joinForm" class="row2" autocomplete="off"><label class="sr" for="joinName">Your name</label>
      <input id="joinName" class="in" placeholder="Not listed? Type your name" maxlength="24" enterkeyhint="go" autocapitalize="words">
      <button class="btn" type="submit" style="flex:0 0 auto">Join</button></form>`}`);
}

// Whose items the item controls change: the host can switch to editing someone else's.
const who = () => (editFor && T.people[editFor] ? editFor : me);
const shortName = (p) => (p === me ? 'You' : p === HOST ? T.payer.name : nameOf(p));

// "Nick ×4, Anna ×3" or "Anna, Nick" or "Everyone but Ben"
// "Nick ×4, Anna" or "Ryan, Haven & Christina" or "Everyone but Ben"
function holders(it, inf) {
  if (!inf.ent.length) return '';
  if (T.mode === 'even') {
    const all = people().length;
    if (inf.ent.length === all) return 'Everyone';
    const outs = people().filter((p) => !inf.ent.some(([id]) => id === p.id)).map((p) => shortName(p.id));
    return outs.length <= 2 ? `Everyone but ${outs.join(' and ')}` : inf.ent.map(([id]) => shortName(id)).join(', ');
  }
  const groups = new Map();
  for (const sl of inf.slots) if (sl.length) { const k = sl.join('+'); groups.set(k, (groups.get(k) || 0) + 1); }
  return [...groups].map(([k, n]) => {
    const names = k.split('+').map(shortName);
    const who_ = names.length > 1 ? `${names.slice(0, -1).join(', ')} & ${names.at(-1)}` : names[0];
    return n > 1 ? `${who_} ×${n}` : who_;
  }).join(', ');
}
const needsSomeone = (it, inf) => !inf.done;

function itemsList(C) {
  const even = T.mode === 'even';
  const target = who();
  let html = '';
  if (editFor && T.people[editFor]) {
    html += `<div class="banner edit" role="status"><span>Editing <b>${esc(nameOf(editFor))}</b>’s items. Tap to add or remove.</span>
      <button type="button" class="btn sm" data-act="editdone">Done</button></div>`;
  } else {
    html += `<p class="note" style="margin:0 2px 12px">${even ? 'Everything is split evenly. Untick anything you didn’t have.' : 'Tap what you had. For a shared plate, use ⋯ to add everyone who shared it.'}</p>`;
  }
  const needs = T.items.filter((it) => needsSomeone(it, C.info[it.id]));
  const taken = T.items.filter((it) => !needsSomeone(it, C.info[it.id]));
  if (needs.length) {
    html += `<h2 class="group">${even ? 'Nobody had these' : 'Needs someone'} <span class="count warn">${needs.length}</span></h2>
      <div class="rows">${needs.map((it) => itemRowHtml(it, C, target)).join('')}</div>`;
  }
  if (taken.length) {
    html += `<h2 class="group">${even ? 'Shared' : 'Claimed'} <span class="count ok">${taken.length}</span></h2>
      <div class="rows">${taken.map((it) => itemRowHtml(it, C, target)).join('')}</div>`;
  }
  return html;
}

function itemRowHtml(it, C, target) {
  const inf = C.info[it.id], even = T.mode === 'even';
  const mine = count(it, target) > 0;
  const forName = target === me ? '' : ` for ${nameOf(target)}`;
  let status;
  if (!inf.ent.length) status = `<span class="st warn">${even ? 'Nobody' : 'Unclaimed'}</span>`;
  else if (!even && it.qty > 1 && inf.left > 0) status = `<span class="st warn">${inf.left} of ${it.qty} left</span>`;
  else status = '<span class="st ok">✓</span>';
  const price = !even && it.qty > 1 ? `${fmt(it.cents / it.qty)} each` : fmt(it.cents);
  const meta = [`<span class="money">${price}</span>`, status];
  const h = holders(it, inf);
  if (h) meta.push(`<span class="who">${esc(h)}</span>`);
  if (mine && inf.out[target] != null) meta.push(`<b class="money">${target === me ? 'You' : esc(nameOf(target))} ${fmt(inf.out[target])}</b>`);
  const addedBy = T.by && T.by[it.id] && T.by[it.id][target];
  if (!editFor && addedBy && addedBy !== target && (mine || even)) meta.push(`<span class="tag">${even ? 'Changed' : 'Added'} by ${esc(shortName(addedBy))}</span>`);
  const name = esc(it.name);
  if (!even && it.qty > 1) {
    return `<div class="row slotted${mine ? ' mine' : ''}"><div class="row-top">
      <button type="button" class="r-main" data-act="item" data-i="${it.id}" aria-label="${name}: who had each one">
        <span class="r-name">${name} <span class="muted">×${it.qty}</span></span><span class="r-meta">${meta.join('')}</span></button>
      ${T.closed ? '' : `<button type="button" class="more" data-act="item" data-i="${it.id}" aria-label="Who had each ${name}">⋯</button>`}</div>
      ${slotsHtml(it, inf, target)}</div>`;
  }
  const ctl = T.closed ? ''
    : `<button type="button" class="tick" data-act="toggle" data-i="${it.id}" aria-pressed="${mine}" aria-label="${name}${forName}">${CHECK}</button>`;
  return `<div class="row${mine ? ' mine' : ''}">
    <button type="button" class="r-main" data-act="item" data-i="${it.id}" aria-label="${name}: who had it">
      <span class="r-name">${name}</span><span class="r-meta">${meta.join('')}</span></button>
    ${ctl}
    ${T.closed ? '' : `<button type="button" class="more" data-act="item" data-i="${it.id}" aria-label="Who shared ${name}">⋯</button>`}</div>`;
}

// One slot per unit on the receipt. A slot shows who had it: one initial, or
// two for a shared one ("H C"), or "+" when it's open.
function slotFace(ps) {
  if (!ps.length) return { face: '+', style: '' };
  const cols = ps.map((p) => pc(T.people[p]));
  const style = cols.length === 1 ? `--pc:${cols[0]}` : `background:linear-gradient(135deg,${cols[0]} 50%,${cols[1]} 50%)`;
  const face = ps.length === 1 ? initial(T.people[ps[0]].name) : ps.length === 2 ? ps.map((p) => initial(T.people[p].name)).join('') : `${initial(T.people[ps[0]].name)}+${ps.length - 1}`;
  return { face: esc(face), style };
}
function slotsHtml(it, inf, target) {
  const name = esc(it.name);
  const slots = inf.slots.map((ps, k) => {
    const n = `${name} ${k + 1} of ${it.qty}`;
    const names = ps.map(shortName);
    const label = !ps.length ? `${n}: open, tap to take it${target === me ? '' : ` for ${esc(nameOf(target))}`}`
      : ps.includes(target) ? `${n}: ${esc(names.join(' and '))}. Tap to ${target === me ? 'give yours back' : `take ${esc(nameOf(target))} off`}`
        : `${n}: ${esc(names.join(' and '))}. Tap if ${target === me ? 'you' : esc(nameOf(target))} shared it`;
    const cls = !ps.length ? 'slot open' : ps.includes(target) ? 'slot mine' : 'slot taken';
    const { face, style } = slotFace(ps);
    return `<button type="button" class="${cls}${ps.length > 1 ? ' shared' : ''}" ${style ? `style="${style}"` : ''} data-act="slot" data-i="${it.id}" data-k="${k}" data-owner="${ps.join('+')}" aria-label="${label}" ${T.closed ? 'disabled' : ''}>${face}</button>`;
  }).join('');
  return `<div class="slots" role="group" aria-label="${name}, one per drink or plate">${slots}</div>`;
}

function statusOf(r) {
  const p = r.p;
  if (p.id === HOST) return ['', `Paid the bill · own share ${fmt(r.total)}`];
  if (p.waived && r.settled) return ['done', p.paid ? `Paid ${fmt(p.paid)}, rest let go` : 'Let go'];
  if (p.paid != null && r.owed <= SLACK) return p.ok ? ['done', 'Paid ✓'] : ['done', isHost ? `Says paid ${fmt(p.paid)}. Check Venmo` : `Paid ${fmt(p.paid)}`];
  if (p.paid != null) return ['due', `Paid ${fmt(p.paid)}, owes ${fmt(r.owed)} more`];
  if (!r.total) return ['due', 'No items yet'];
  return ['due', `Owes ${fmt(r.owed)}`];
}

function peoplePanel(C) {
  const others = C.res.filter((r) => r.p.id !== HOST);
  const pct = C.expected ? Math.min(100, Math.round((C.collected / C.expected) * 100)) : 0;
  let html = `<div class="card"><h3 class="money">${fmt(C.collected)} of ${fmt(C.expected)} paid back</h3>
    <div class="bar" aria-hidden="true"><i style="width:${pct}%"></i></div></div>`;

  if (C.openItems.length || Math.abs(C.pool) > SLACK) {
    const n = C.openItems.length;
    html += `<div class="card attention"><h3 class="money">${n ? `${n} ${n === 1 ? 'item needs' : 'items need'} someone` : 'Not covered yet'} · ${fmt(C.pool)}</h3>
      <p class="note" style="margin-top:0">${isHost ? 'Until it’s settled, this is on you.' : `Nobody has claimed these yet, so ${esc(T.payer.name)} is covering them for now.`}</p>`;
    if (n) {
      html += `<ul class="lines">${C.openItems.map((it) => {
        const inf = C.info[it.id];
        const what = T.mode !== 'even' && it.qty > 1 ? `${inf.left} × ${it.name}` : it.name;
        return `<li><span>${esc(what)}</span>${isHost ? `<button type="button" class="btn sm ghost" data-act="assign" data-i="${it.id}">Who had it?</button>` : `<button type="button" class="btn sm ghost" data-act="item" data-i="${it.id}">I had it</button>`}</li>`;
      }).join('')}</ul>`;
    }
    if (!T.closed && isHost) {
      html += `<div class="acts"><button type="button" class="btn sm" data-act="pool" data-v="spread">Split across everyone who hasn’t paid</button>
        <button type="button" class="btn sm ghost" data-act="pool" data-v="cover">I’ll cover it</button></div>`;
    }
    html += '</div>';
  } else if (T.pool) {
    html += `<p class="banner ok">${T.pool === 'spread' ? 'Anything unclaimed is split across everyone who hasn’t paid.' : `${isHost ? 'You’re' : esc(T.payer.name) + ' is'} covering anything unclaimed.`}${isHost ? ' <button type="button" class="link" data-act="pool" data-v="none">Undo</button>' : ''}</p>`;
  }

  html += `<h2 class="group">People <span class="count">${others.length + 1}</span></h2>
    <div class="stack">${[C.byId[HOST], ...others].map((r) => personCard(r)).join('')}</div>
    ${T.closed || !isHost ? '' : `<form id="addPerson" class="row2" style="margin-top:12px" autocomplete="off"><label class="sr" for="addPersonName">Add someone</label>
      <input id="addPersonName" class="in" placeholder="Add someone" maxlength="24"><button class="btn" type="submit" style="flex:0 0 auto">Add</button></form>`}`;

  if (!isHost) return html;
  const allDone = C.allPaid || (others.every((r) => r.settled || !r.total) && Math.abs(C.pool) <= SLACK);
  html += `<h2 class="group">Tab</h2><div class="card"><div class="acts" style="margin-top:0">
    <button type="button" class="btn sm ghost" data-act="share">Share the link</button>
    <button type="button" class="btn sm ghost" data-act="report">See the report</button>
    ${/^deploy-preview-/.test(location.hostname) ? `<a class="btn sm" href="${LIVE}/t/${tabId}#h=${encodeURIComponent(hostKey)}">Open on the live site</a>` : ''}
    ${T.closed ? '<button type="button" class="btn sm ghost" data-act="reopen">Reopen</button>'
    : `<button type="button" class="btn sm${allDone ? '' : ' ghost'}" data-act="close" ${allDone ? '' : 'aria-describedby="closeNote"'}>Close the tab</button>`}</div>
    ${!T.closed && !allDone ? '<p class="note" id="closeNote">You can close it once everyone has paid and nothing is left uncovered.</p>' : ''}</div>`;
  return html;
}

function personCard(r) {
  const p = r.p, isMe = p.id === me, [cls, status] = statusOf(r);
  const items = r.lines.length
    ? `<ul class="mini-items">${r.lines.map((l) => `<li><span>${esc(l.label)}</span><span class="money">${fmt(l.amt)}</span></li>`).join('')}
       <li class="muted"><span>Tax, fees and tip</span><span class="money">${fmt(r.extrasR)}</span></li></ul>`
    : '<p class="note" style="margin:6px 0 0">No items yet.</p>';
  let acts = '';
  let more = '';
  if (!T.closed && !isHost) {
    if (p.id === me) {
      acts += `<button type="button" class="btn sm ghost" data-act="editdone">Edit my items</button>`;
      if (r.owed > SLACK && !r.settled) acts += `<button type="button" class="btn sm" data-act="mine">Review and pay</button>`;
    }
  } else if (!T.closed) {
    acts += `<button type="button" class="btn sm ghost" data-act="editfor" data-p="${p.id}">Edit items</button>`;
    if (p.id !== HOST && !r.settled && r.owed > SLACK) acts += `<button type="button" class="btn sm" data-act="remind" data-p="${p.id}">Remind privately</button>`;
    if (p.id !== HOST) {
      if (!r.settled && r.owed > SLACK) more += `<button type="button" class="btn sm ghost" data-act="markpaid" data-p="${p.id}">Mark paid</button>`;
      if (p.paid != null && !p.ok) more += `<button type="button" class="btn sm ghost" data-act="confirm" data-p="${p.id}">Got it</button>`;
      if (p.paid != null && r.owed > SLACK) more += `<button type="button" class="btn sm ghost" data-act="waive" data-p="${p.id}">Let the ${fmt(r.owed)} go</button>`;
      if (p.paid != null) more += `<button type="button" class="btn sm ghost" data-act="unpaid" data-p="${p.id}">Undo payment</button>`;
      more += `<button type="button" class="btn sm ghost" data-act="remove" data-p="${p.id}">Remove</button>`;
    }
  }
  const n = r.lines.length;
  return `<div class="card person-card${cls === 'due' && r.total ? ' due' : ''}${cls === 'done' ? ' done' : ''}">
    <details class="pc" data-p="${p.id}" ${openCards.has(p.id) ? 'open' : ''}>
    <summary class="pc-head">${av(p)}<span class="p-name"><b>${isMe ? 'You' : esc(p.name)}${p.id === HOST && !isMe ? ' <span class="muted">(paid)</span>' : ''}</b><small class="${cls}">${esc(status)}${n ? ` · ${n} item${n === 1 ? '' : 's'}` : ''}</small></span><b class="money pc-total">${fmt(r.total)}</b><span class="chev" aria-hidden="true"></span></summary>
    ${items}
    ${r.locked ? '<p class="note">Locked when they paid, so later changes won’t move it.</p>' : ''}
    </details>
    ${acts ? `<div class="acts">${acts}${more ? `<details class="more-acts" data-p="${p.id}" ${openPeople.has(p.id) ? 'open' : ''}><summary class="btn sm ghost">More</summary><div class="acts">${more}</div></details>` : ''}</div>` : ''}
  </div>`;
}

function linesHtml(r) {
  if (!r.lines.length) return '<p class="note">Nothing claimed yet.</p>';
  return `<ul class="lines">${r.lines.map((l) => `<li><span>${esc(l.label)}</span><span class="money">${fmt(l.amt)}</span></li>`).join('')}
    <li><span>Tax, fees and tip</span><span class="money">${fmt(r.extrasR)}</span></li>
    <li class="tot"><span>Total</span><span class="money">${fmt(r.total)}</span></li></ul>
    ${r.locked ? '<p class="note">Locked when they paid, so later changes won’t move it.</p>' : ''}`;
}

function renderDock(C) {
  const dock = $('#dock');
  dock.hidden = false;
  if (editFor && T.people[editFor]) {
    const r = C.byId[editFor];
    setHTML($('#dockIn'), `<div class="dock-sum" aria-live="polite"><span>${esc(nameOf(editFor))}’s total</span><strong class="money">${fmt(r.total)}</strong><small>Tax and tip included</small></div>
      <button type="button" class="btn" data-act="editdone">Done</button>`);
    return;
  }
  const r = C.byId[me];
  let left, right = '';
  if (me === HOST) {
    left = `<span>Paid back to you</span><strong class="money">${fmt(C.collected)}</strong><small class="money">of ${fmt(C.expected)}</small>`;
    right = T.closed ? '' : '<button type="button" class="btn" data-act="share">Share link</button>';
  } else if (r.p.paid != null && r.owed <= SLACK) {
    left = `<span>You’re all set</span><strong class="money">${fmt(r.total)}</strong><small>${r.p.ok ? `${esc(T.payer.name)} confirmed it` : 'Marked as paid'}</small>`;
    right = '<button type="button" class="btn ghost" data-act="mine">Details</button>';
  } else if (!r.total) {
    left = `<span>Your total</span><strong class="money">$0.00</strong><small>${T.mode === 'even' ? 'Tap items you had' : 'Tap what you had'}</small>`;
  } else {
    left = `<span>${r.p.paid != null ? 'Still to pay' : 'Your total'}</span><strong class="money">${fmt(r.owed)}</strong><small>Tax and tip included</small>`;
    right = T.closed ? '' : '<button type="button" class="btn" data-act="mine">Review and pay</button>';
  }
  setHTML($('#dockIn'), `<div class="dock-sum" aria-live="polite">${left}</div>${right}`);
}

/* ---------- Sheets ---------- */
const dlg = $('#sheet');
function openSheet(s) { sheet = s; const b = $('#sheetBody'); b._h = null; renderSheet(compute_()); if (!dlg.open) { if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', ''); } }
function closeSheet() { sheet = null; if (dlg.open) { if (dlg.close) dlg.close(); else dlg.removeAttribute('open'); } }
dlg.addEventListener('close', () => { sheet = null; const b = $('#sheetBody'); b._h = null; b.innerHTML = ''; });
dlg.addEventListener('click', (e) => { if (e.target === dlg) closeSheet(); });
const done = (label = 'Done') => `<button type="button" class="btn ghost wide" data-act="close-sheet">${label}</button>`;

function renderSheet(C) {
  const b = $('#sheetBody');
  const s = sheet;
  if (!s) return;
  if (s.type === 'item') {
    const it = T.items.find((x) => x.id === s.i); if (!it) { closeSheet(); return; }
    const inf = C.info[it.id], even = T.mode === 'even';
    const k = Math.min(s.k || 0, it.qty - 1);
    const t = who();
    const order = [t, ...people().map((p) => p.id).filter((id) => id !== t)];
    const slot = even ? null : inf.slots[k];
    const isIn = (pid) => (even ? units(it.id, pid) > 0 : slot.includes(pid));
    const rows = order.map((pid) => {
      const p = T.people[pid], label = pid === me ? 'You' : esc(p.name);
      return `<div class="prow">${av(p)}<span class="grow">${label}</span>
        <button type="button" class="tick" data-act="s-toggle" data-p="${pid}" aria-pressed="${isIn(pid)}" aria-label="${label} had ${even || it.qty < 2 ? esc(it.name) : `number ${k + 1}`}">${CHECK}</button></div>`;
    }).join('');
    const title = `<h2 id="sheetTitle">${esc(it.name)} <span class="muted money">${fmt(it.cents)}</span></h2>`;
    if (even || it.qty < 2) {
      const sub = even ? 'Everyone ticked splits it evenly.' : 'Tick everyone who had it. It’s split evenly between them.';
      setHTML(b, `<div class="sh">${title}<p class="sub">${sub}</p>${rows}<div class="sh-foot">${done()}</div></div>`);
      return;
    }
    // Several on the receipt: how many each person had, then (optionally) who shared a single one.
    const open = inf.slots.filter((x) => !x.length).length;
    const counts = order.map((pid) => {
      const p = T.people[pid], label = pid === me ? 'You' : esc(p.name);
      const n = inf.slots.filter((x) => x.includes(pid)).length;
      const shared = inf.slots.filter((x) => x.length > 1 && x.includes(pid)).length;
      return `<div class="prow">${av(p)}<span class="grow">${label}${shared ? ` <span class="muted">(${shared} shared)</span>` : ''}</span>
        <span class="stepper"><button type="button" data-act="s-dec" data-p="${pid}" aria-label="One fewer for ${label}" ${n ? '' : 'disabled'}>−</button><output aria-label="${label} has">${n}</output><button type="button" data-act="s-inc" data-p="${pid}" aria-label="One more for ${label}" ${open ? '' : 'disabled'}>+</button></span></div>`;
    }).join('');
    const strip = `<div class="slots sheet-slots" role="group" aria-label="Each one on the receipt">${inf.slots.map((ps, j) => {
      const { face, style } = slotFace(ps);
      return `<button type="button" class="slot ${ps.length ? 'taken' : 'open'}${s.share && j === k ? ' picked' : ''}" ${style ? `style="${style}"` : ''} data-act="s-pick" data-k="${j}" aria-pressed="${!!s.share && j === k}" aria-label="Number ${j + 1}: ${ps.length ? esc(ps.map(shortName).join(' and ')) : 'open'}. Tap to choose who shared it">${face}</button>`;
    }).join('')}</div>`;
    let share = '';
    if (s.ask && slot.length && !slot.includes(t)) {
      share += `<div class="banner"><p style="margin:0 0 8px">Number ${k + 1} is ${esc(slot.map(shortName).join(' and '))}’s. Did ${t === me ? 'you' : esc(nameOf(t))} share it?</p>
        <button type="button" class="btn sm" data-act="s-yes">Yes, ${t === me ? 'I' : esc(nameOf(t))} shared it</button></div>`;
    }
    if (s.share) {
      share += `<h3 class="sheet-h">Who shared number ${k + 1}?</h3>${rows}
        ${slot.length ? `<button type="button" class="btn ghost wide" data-act="s-all" style="margin-top:10px">Same people for all ${it.qty}</button>` : ''}`;
    }
    setHTML(b, `<div class="sh">${title}
      <p class="sub">${it.qty} on the receipt at ${fmt(it.cents / it.qty)} each. ${open ? `${open} still open.` : 'All accounted for.'}</p>
      ${strip}
      <h3 class="sheet-h">How many each person had</h3>${counts}
      ${share || '<p class="note">If two people shared one, tap it above to pick who.</p>'}
      <div class="sh-foot">${done()}</div></div>`);
  } else if (s.type === 'mine') {
    const r = C.byId[me];
    let pay = '';
    if (me !== HOST && r.owed > SLACK && !T.closed) {
      pay = T.payer.venmo
        ? `<a class="btn wide" href="${venmoUrl(r.owed)}" target="_blank" rel="noopener" data-act="venmo" data-amt="${r.owed}">Pay ${fmt(r.owed)} on Venmo</a>`
        : `<p class="banner">${esc(T.payer.name)} didn’t add a Venmo username. Pay them however you usually do, then record it.</p>`;
      pay += `<button type="button" class="btn ghost wide" data-act="other">I paid another way</button>`;
    }
    if (me !== HOST && r.p.paid != null && !T.closed) pay += `<button type="button" class="link" data-act="unpaid-me">Undo my payment</button>`;
    setHTML(b, `<div class="sh"><h2 id="sheetTitle">${me === HOST ? 'Your share' : 'Your total'} <span class="money">${fmt(r.total)}</span></h2>
      <p class="sub">Your items, plus your share of tax, fees and tip in proportion to what you had.</p>
      ${linesHtml(r)}
      ${r.p.paid != null && me !== HOST ? `<p class="banner ${r.owed <= SLACK ? 'ok' : ''} money">You’ve paid ${fmt(r.p.paid)}${r.p.waived ? `; ${esc(T.payer.name)} let ${fmt(r.p.waived)} go` : ''}${r.owed > SLACK ? `. ${fmt(r.owed)} left.` : '.'}</p>` : ''}
      <div class="sh-foot">${pay}${done('Close')}</div></div>`);
  } else if (s.type === 'paycheck') {
    setHTML(b, `<div class="sh"><h2 id="sheetTitle">Did your Venmo go through?</h2><p class="sub">Mark it so ${esc(T.payer.name)} knows you’re square.</p>
      <div class="sh-foot"><button type="button" class="btn wide" data-act="paidyes" data-amt="${s.amt}">Yes, I paid ${fmt(s.amt)}</button>${done('Not yet')}</div></div>`);
  } else if (s.type === 'other' || s.type === 'markpaid') {
    if (b.querySelector('#amount')) return; // keep what they're typing
    const who = s.type === 'other' ? me : s.p;
    const r = C.byId[who];
    b._h = null;
    b.innerHTML = `<div class="sh"><h2 id="sheetTitle">${s.type === 'other' ? 'How much did you send?' : `What did ${esc(nameOf(who))} pay?`}</h2>
      <p class="sub">${s.type === 'other' ? 'Cash, Zelle, anything. Put in what you actually sent.' : 'Put in what they actually paid you.'}</p>
      <form id="amountForm"><label class="sr" for="amount">Amount in dollars</label>
      <input id="amount" class="in money" inputmode="decimal" value="${dollars(Math.max(0, r.owed))}" autocomplete="off">
      <div class="sh-foot"><button class="btn wide" type="submit">Save</button>${done('Cancel')}</div></form></div>`;
  } else if (s.type === 'created') {
    setHTML(b, `<div class="sh"><h2 id="sheetTitle">Your tab is ready</h2>
      <p class="sub">Send the link to the group chat. Everyone taps their name, picks what they had and pays you.</p>
      <div class="sh-foot"><button type="button" class="btn wide" data-act="share">Send the link</button>${done('Later')}</div>
      <p class="note">This phone is now the host. Keep this page’s address to manage the tab from another device: ${esc(location.origin)}/t/${tabId}#h=${esc(hostKey)}</p></div>`);
  } else if (s.type === 'who') {
    if (b.querySelector('#renameInput')) return;
    const p = T.people[me];
    b._h = null;
    b.innerHTML = `<div class="sh"><h2 id="sheetTitle">You’re ${esc(p.name)}</h2><p class="sub">Fix your name, or switch if this isn’t you.</p>
      <form id="renameForm"><label class="sr" for="renameInput">Your name</label><input id="renameInput" class="in" maxlength="24" value="${esc(p.name)}">
      <div class="sh-foot"><button class="btn wide" type="submit">Save name</button>
      ${me === HOST ? '' : `<button type="button" class="btn ghost wide" data-act="switch">I’m not ${esc(p.name)}</button>`}${done('Close')}</div></form></div>`;
  }
}

/* ---------- Actions on a tab ---------- */
function setUnits(i, p, u) { // even split: in (1) or out (0)
  lastActivity = Date.now();
  pend.set(i + '|' + p, u > 0 ? 1 : 0);
  renderAll(); scheduleFlush();
}
function slotOp(op) { // itemized: take / join / leave a slot
  lastActivity = Date.now();
  pendOps.push(op);
  renderAll(); scheduleFlush();
}
// The tick on a single item: in or out (joining shares it with whoever has it).
function toggleItem(it, p) {
  if (T.mode === 'even') { setUnits(it.id, p, units(it.id, p) > 0 ? 0 : 1); return; }
  const k = 0, sl = slotsNow(it);
  slotOp({ a: sl[k].includes(p) ? 'leave' : 'join', i: it.id, k, p });
}
function setMe(id, fromLink) {
  me = id;
  store.set('tab-me:' + tabId, id);
  if (id) beacon({ op: 'pick', p: id });
  if (!isHost) view = 'items';
  if (!fromLink) { renderAll(); window.scrollTo(0, 0); }
}
async function shareText(text, msg) {
  if (navigator.share) { try { await navigator.share({ text }); return true; } catch (e) { if (e && e.name === 'AbortError') return false; } }
  try { await navigator.clipboard.writeText(text); toast(msg || 'Copied. Paste it in a message.'); return true; } catch (e) { toast('Couldn’t copy. Long-press the link to copy it.'); return false; }
}
function shareLink() {
  track('share_tapped');
  shareText(`Splitting ${T.title || 'the tab'}. Tap your name, pick what you had, and pay ${T.payer.name} back: ${location.origin}/t/${tabId}`, 'Link copied. Paste it in the group chat.');
}
function remind(pid) {
  const r = compute_().byId[pid];
  track('nudge_sent', { to: pid });
  shareText(`Hi ${r.p.name}! For ${T.title || 'the tab'}, your share comes to ${fmt(r.owed)}, tax and tip included. Here’s your link to check it and pay: ${personalLink(pid)}`, 'Reminder copied. Send it to them directly.');
}
function afterVenmo(amt) {
  track('pay_tapped', { amount: Math.round(amt) });
  payReturn = { amt };
  setTimeout(() => { if (payReturn && !document.hidden) openSheet({ type: 'paycheck', amt: payReturn.amt }); }, 1500);
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { clearTimeout(pollT); return; }
  lastActivity = Date.now();
  if (payReturn) openSheet({ type: 'paycheck', amt: payReturn.amt });
  if (tabId && T) { poll(); if (pend.size || pendOps.length) scheduleFlush(50); }
});

app.addEventListener('click', (e) => {
  if (!tabId || !T) return;
  const b = e.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act;
  lastActivity = Date.now();
  if (a === 'pick') { setMe(b.dataset.p); toast(`Hi ${nameOf(b.dataset.p)}! Tap what you had.`); return; }
  if (a === 'view') { view = b.dataset.v; editFor = null; renderAll(); return; }
  const it = b.dataset.i && T.items.find((x) => x.id === b.dataset.i);
  if (a === 'item' && it) { openSheet({ type: 'item', i: it.id }); return; }
  if (a === 'slot' && it) {
    const k = Number(b.dataset.k), t = who(), sl = slotsNow(it)[k] || [];
    if (!sl.length) slotOp({ a: 'take', i: it.id, p: t });
    else if (sl.includes(t)) slotOp({ a: 'leave', i: it.id, k, p: t });
    else openSheet({ type: 'item', i: it.id, k, ask: true, share: true });
    return;
  }
  if (a === 'toggle' && it) toggleItem(it, who());
  if (a === 'editfor') { editFor = b.dataset.p === me ? null : b.dataset.p; view = 'items'; renderAll(); window.scrollTo(0, 0); return; }
  if (a === 'editdone') { const back = !!editFor; editFor = null; view = back ? 'people' : 'items'; renderAll(); window.scrollTo(0, 0); return; }
  if (a === 'mine') { openSheet({ type: 'mine' }); return; }
  if (a === 'assign' && it) { view = 'items'; editFor = null; renderAll(); openSheet({ type: 'item', i: it.id }); return; }
  if (a === 'pool') act({ op: 'setup', pool: b.dataset.v === 'none' ? null : b.dataset.v }, b.dataset.v === 'spread' ? 'Split across everyone who hasn’t paid' : b.dataset.v === 'cover' ? 'You’re covering it' : 'Undone');
  if (a === 'remind') remind(b.dataset.p);
  if (a === 'markpaid') openSheet({ type: 'markpaid', p: b.dataset.p });
  if (a === 'confirm') act({ op: 'confirm', p: b.dataset.p }, `Confirmed ${nameOf(b.dataset.p)}’s payment`);
  if (a === 'waive') act({ op: 'waive', p: b.dataset.p }, 'Let it go');
  if (a === 'unpaid') act({ op: 'unpaid', p: b.dataset.p }, 'Payment undone');
  if (a === 'remove' && confirm(`Remove ${nameOf(b.dataset.p)}? Their items go back to unclaimed.`)) { openPeople.delete(b.dataset.p); act({ op: 'remove', p: b.dataset.p }, 'Removed'); }
  if (a === 'share') shareLink();
  if (a === 'report') window.open(`/api/report?t=${tabId}&key=${encodeURIComponent(hostKey)}`, '_blank', 'noopener');
  if (a === 'close' && confirm('Close the tab? Nobody can change it after this, but you can reopen it.')) act({ op: 'close' }, 'Tab closed');
  if (a === 'reopen') act({ op: 'reopen' }, 'Tab reopened');
});
app.addEventListener('toggle', (e) => {
  const d = e.target;
  if (d.classList && d.classList.contains('more-acts')) { if (d.open) openPeople.add(d.dataset.p); else openPeople.delete(d.dataset.p); }
  if (d.classList && d.classList.contains('pc')) { if (d.open) openCards.add(d.dataset.p); else openCards.delete(d.dataset.p); }
}, true);
app.addEventListener('submit', async (e) => {
  if (!tabId || !T) return;
  if (e.target.id === 'joinForm') {
    e.preventDefault();
    const name = $('#joinName').value.trim(); if (!name) return;
    const r = await act({ op: 'join', name });
    if (r && r.person) { setMe(r.person); toast(`Hi ${nameOf(r.person)}! Tap what you had.`); }
  }
  if (e.target.id === 'addPerson') {
    e.preventDefault();
    const name = $('#addPersonName').value.trim(); if (!name) return;
    const r = await act({ op: 'add', name }, `Added ${name}`);
    if (r) { $('#addPersonName').value = ''; }
  }
});

$('#meBtn').addEventListener('click', () => openSheet({ type: 'who' }));
$('#dockIn').addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  if (b.dataset.act === 'mine') openSheet({ type: 'mine' });
  if (b.dataset.act === 'share') shareLink();
  if (b.dataset.act === 'editdone') { editFor = null; view = 'people'; renderAll(); window.scrollTo(0, 0); }
});
$('#sheetBody').addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]'); if (!b || !sheet) return;
  const a = b.dataset.act, s = sheet;
  lastActivity = Date.now();
  if (a === 'close-sheet') { if (s.type === 'paycheck') payReturn = null; closeSheet(); return; }
  if (a === 'share') { shareLink(); return; }
  if (a === 'venmo') { afterVenmo(Number(b.dataset.amt)); return; }
  if (a === 'other') { openSheet({ type: 'other' }); return; }
  if (a === 'paidyes') { payReturn = null; closeSheet(); act({ op: 'paid', p: me, amount: Number(b.dataset.amt), how: 'venmo' }, 'Marked as paid. Thanks!'); return; }
  if (a === 'unpaid-me') { closeSheet(); act({ op: 'unpaid', p: me }, 'Payment undone'); return; }
  if (a === 'switch') { closeSheet(); me = null; store.set('tab-me:' + tabId, null); renderAll(); return; }
  if (s.type === 'item') {
    const it = T.items.find((x) => x.id === s.i); if (!it) return;
    const k = Math.min(s.k || 0, it.qty - 1);
    if (a === 's-pick') { sheet.k = Number(b.dataset.k); sheet.ask = false; sheet.share = true; renderSheet(compute_()); return; }
    if (a === 's-inc') {
      if (!slotsNow(it).some((x) => !x.length)) { toast(`All ${it.qty} are taken. Lower someone first, or tap one to share it.`); return; }
      slotOp({ a: 'take', i: it.id, p: b.dataset.p });
    }
    if (a === 's-dec') {
      const pid = b.dataset.p, sl = slotsNow(it);
      // give back a solo one first, the last one they took
      let j = -1;
      sl.forEach((x, n) => { if (x.length === 1 && x[0] === pid) j = n; });
      if (j < 0) sl.forEach((x, n) => { if (x.includes(pid)) j = n; });
      if (j >= 0) slotOp({ a: 'leave', i: it.id, k: j, p: pid });
    }
    if (a === 's-yes') { sheet.ask = false; sheet.share = true; slotOp({ a: 'join', i: it.id, k, p: who() }); return; }
    if (a === 's-toggle') {
      const pid = b.dataset.p;
      if (T.mode === 'even') setUnits(it.id, pid, units(it.id, pid) > 0 ? 0 : 1);
      else slotOp({ a: slotsNow(it)[k].includes(pid) ? 'leave' : 'join', i: it.id, k, p: pid });
    }
    if (a === 's-all') {
      const ps = slotsNow(it)[k].slice();
      flush().then(() => act({ op: 'shareAll', i: it.id, ps }, `All ${it.qty} shared by ${ps.length}`));
    }
  }
});
$('#sheetBody').addEventListener('submit', (e) => {
  e.preventDefault();
  const s = sheet; if (!s) return;
  if (e.target.id === 'amountForm') {
    const c = toCents($('#amount').value);
    if (!Number.isInteger(c) || c <= 0) { toast('Enter an amount'); return; }
    const p = s.type === 'other' ? me : s.p;
    closeSheet();
    act({ op: 'paid', p, amount: c, how: 'other' }, s.type === 'other' ? 'Recorded. Thanks!' : `Marked ${nameOf(p)} as paid`);
  }
  if (e.target.id === 'renameForm') {
    const name = $('#renameInput').value.trim(); if (!name) return;
    closeSheet(); act({ op: 'rename', p: me, name }, 'Name updated');
  }
});
window.addEventListener('online', () => { if (tabId) { poll(); if (pend.size || pendOps.length) scheduleFlush(50); } });
window.addEventListener('pagehide', () => { if (pend.size || pendOps.length) flush(); });
window.addEventListener('popstate', () => location.reload());

/* ---------- Start ---------- */
async function start() {
  if (!tabId) { renderStart(); return; }
  if (hostKey) {
    let missing = false;
    try { const d = await post({ op: 'checkhost', t: tabId, key: hostKey }); isHost = !!d.isHost; } catch (e) { isHost = false; missing = e.status === 404; }
    if (isHost) { me = HOST; store.set('tab-me:' + tabId, HOST); } else if (!missing) { hostKey = null; }
  }
  if (isHost) view = 'people';
  await poll(true);
  track('link_opened');
}
start();

// For tests
export const _debug = { get T() { return T; }, get me() { return me; }, get isHost() { return isHost; }, flush, itemsTotal };
