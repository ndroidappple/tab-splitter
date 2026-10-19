// Split math shared by the page and the server, so both always agree.
// All amounts are whole cents.
//
// One rule for everything that isn't an item: tax, fees, gratuity and tip are
// whatever the card was charged beyond the items, and each person pays that in
// proportion to what they had.

export const HOST = 'host';
export const SLACK = 1; // cents of rounding we treat as settled

// Everyone on the tab: host first, then in the order they were added.
export function people(T) {
  return Object.entries(T.people || {}).map(([id, v]) => Object.assign({ id }, v))
    .sort((a, b) => (a.id === HOST ? -1 : b.id === HOST ? 1 : (a.t || 0) - (b.t || 0)));
}

export const itemsTotal = (T) => (T.items || []).reduce((s, it) => s + it.cents, 0);

// Receipts often repeat the count in the name ("3 Door County Cherry Mojito" ×3).
export function tidyName(name, qty) {
  const s = String(name || '').trim();
  const m = s.match(/^(\d+)\s*[x×]?\s+(.+)$/i);
  return m && Number(m[1]) === qty && qty > 1 ? m[2] : s;
}

// Every item is a row of slots, one per unit on the receipt ("Fish and Chips ×2"
// has 2). Each slot holds the people who had that one: one person, a few who
// shared it, or nobody yet. A slot's price is split evenly among its people.
// Tabs saved before slots existed are read from their old per-person counts.
export function slotsOf(T, it) {
  const saved = T.slots && T.slots[it.id];
  if (Array.isArray(saved)) {
    return Array.from({ length: it.qty }, (_, k) => (Array.isArray(saved[k]) ? saved[k].filter((p) => T.people[p]) : []));
  }
  const out = Array.from({ length: it.qty }, () => []);
  const c = (T.claims && T.claims[it.id]) || {};
  const ids = people(T).map((p) => p.id).filter((p) => c[p] > 0);
  const shared = it.qty < 2 || (T.modes && T.modes[it.id] === 'share');
  if (shared) out.forEach((slot) => slot.push(...ids));
  else {
    let k = 0;
    for (const p of ids) for (let u = 0; u < c[p] && k < it.qty; u++) out[k++].push(p);
  }
  return out;
}

// "Fish and Chips", "Carbliss ×4", "Cheese Curds ×2, split 4 ways", "Fish and Chips, split with Haven"
function slotLabel(it, slots, p, nameOf) {
  const name = tidyName(it.name, it.qty);
  const solo = slots.filter((s) => s.length === 1 && s[0] === p).length;
  const shared = slots.filter((s) => s.length > 1 && s.includes(p));
  if (!shared.length) return it.qty > 1 ? `${name} ×${solo}` : name;
  let how;
  if (shared.length === 1 && shared[0].length === 2) how = `split with ${nameOf(shared[0].find((x) => x !== p))}`;
  else {
    const sizes = new Set(shared.map((s) => s.length));
    how = sizes.size === 1 ? `split ${[...sizes][0]} ways` : 'shared';
  }
  if (solo) return `${name} ×${solo}, plus ${shared.length > 1 ? `${shared.length} ` : 'one '}${how}`;
  return `${name}${shared.length > 1 ? ` ×${shared.length}` : ''}, ${how}`;
}

// Splits `target` cents across `weights` so the parts add up exactly
// (largest remainder). Equal parts when every weight is zero.
export function apportion(target, weights) {
  const n = weights.length;
  if (!n) return [];
  const sum = weights.reduce((a, b) => a + b, 0);
  const w = sum > 0 ? weights : weights.map(() => 1);
  const ws = sum > 0 ? sum : n;
  const exact = w.map((x) => (target * x) / ws);
  const base = exact.map((x) => Math.floor(x + 1e-9));
  let rem = target - base.reduce((a, b) => a + b, 0);
  exact.map((x, i) => [i, x - Math.floor(x + 1e-9)]).sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .forEach(([i]) => { if (rem > 0) { base[i]++; rem--; } });
  return base;
}

// Works out what everyone owes. The page passes its own view of the tab (with
// taps that haven't synced yet) and `isOut`; the server uses saved state.
export function compute(T, opts = {}) {
  const isOut = opts.isOut || ((i, p) => !!(T.out && T.out[i] && T.out[i][p]));
  const even = T.mode === 'even';
  const ppl = people(T);
  const byId = {};
  ppl.forEach((p) => { byId[p.id] = { p, sub: 0, lines: [] }; });
  const nameOf = (id) => (T.people[id] ? T.people[id].name : '');
  const info = {};
  let claimed = 0;
  for (const it of T.items || []) {
    const out = {};
    let slots, filled;
    if (even) {
      const ins = ppl.filter((p) => !isOut(it.id, p.id)).map((p) => p.id);
      slots = [ins];
      ins.forEach((p) => { out[p] = it.cents / ins.length; });
      filled = ins.length ? it.qty : 0;
    } else {
      slots = slotsOf(T, it);
      const unit = it.cents / it.qty;
      filled = 0;
      for (const s of slots) {
        if (!s.length) continue;
        filled++;
        s.forEach((p) => { out[p] = (out[p] || 0) + unit / s.length; });
      }
    }
    const ent = ppl.filter((p) => out[p.id] != null).map((p) => [p.id, slots.filter((s) => s.includes(p.id)).length]);
    const left = even ? (ent.length ? 0 : 1) : it.qty - filled;
    const c = even ? (ent.length ? it.cents : 0) : (filled * it.cents) / it.qty;
    info[it.id] = { slots, ent, out, c, left, filled, done: ent.length > 0 && left === 0 };
    claimed += c;
    ent.forEach(([p]) => {
      byId[p].sub += out[p];
      const label = even
        ? (ent.length === 1 ? tidyName(it.name, it.qty) : `${tidyName(it.name, it.qty)}, split ${ent.length} ways`)
        : slotLabel(it, slots, p, nameOf);
      byId[p].lines.push({ item: it.id, label, amt: out[p] });
    });
  }

  const total = itemsTotal(T);
  const charge = T.charge || 0;
  const factor = total > 0 ? charge / total : 0;
  ppl.forEach((p) => { byId[p.id].exact = byId[p.id].sub * factor; });

  // Paid people keep the total they paid against; everyone else shares the rest.
  const isLocked = (p) => p.id !== HOST && p.lock != null;
  const locked = ppl.filter(isLocked);
  const free = ppl.filter((p) => !isLocked(p));
  const sumLocked = locked.reduce((s, p) => s + p.lock, 0);
  locked.forEach((p) => { byId[p.id].total = p.lock; });

  if (T.pool === 'spread') {
    // Anything not covered is shared by everyone who hasn't paid, by what they had.
    const parts = apportion(charge - sumLocked, free.map((p) => byId[p.id].exact));
    free.forEach((p, i) => { byId[p.id].total = parts[i]; });
  } else {
    const others = T.pool === 'cover' ? free.filter((p) => p.id !== HOST) : free;
    const target = Math.round(others.reduce((s, p) => s + byId[p.id].exact, 0));
    const parts = apportion(target, others.map((p) => byId[p.id].exact));
    others.forEach((p, i) => { byId[p.id].total = parts[i]; });
    if (T.pool === 'cover' && byId[HOST]) {
      // The host takes whatever nobody else covers.
      byId[HOST].total = charge - sumLocked - parts.reduce((a, b) => a + b, 0);
    }
  }

  const res = ppl.map((p) => {
    const r = byId[p.id];
    r.subR = Math.round(r.sub);
    r.extrasR = r.total - r.subR;
    r.locked = isLocked(p);
    r.owed = p.id === HOST ? 0 : r.total - (p.paid || 0) - (p.waived || 0);
    r.settled = p.id === HOST || (p.paid != null && r.owed <= SLACK);
    return r;
  });
  const assigned = res.reduce((s, r) => s + r.total, 0);
  const others = res.filter((r) => r.p.id !== HOST);
  const owing = others.filter((r) => r.total > 0);
  const openItems = (T.items || []).filter((it) => !info[it.id].done);
  const pool = charge - assigned; // not on anyone yet
  return {
    ppl, res, byId, info, claimed, itemsTotal: total, charge, extras: charge - total,
    pool, openItems,
    collected: others.reduce((s, r) => s + (r.p.paid || 0), 0),
    expected: others.reduce((s, r) => s + r.total, 0),
    allClaimed: openItems.length === 0 && (T.items || []).length > 0,
    allPaid: owing.length > 0 && Math.abs(pool) <= SLACK && owing.every((r) => r.settled),
  };
}
