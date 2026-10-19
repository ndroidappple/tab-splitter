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

function lineLabel(it, m, u, n, tot, even) {
  if (m === 'count' && tot <= it.qty) return it.qty > 1 ? `${it.name} ×${u}` : it.name;
  if (m === 'count') return `${it.name} ×${u} (${tot} claimed, ${it.qty} on the receipt)`;
  if (n === 1) return it.name;
  return even ? `${it.name}, split ${n} ways` : `${it.name}, ${u} of ${tot} shares`;
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

// Works out what everyone owes. The page passes `units`, `modeOf` and `isOut`
// so taps that haven't synced yet show right away; the server uses saved state.
export function compute(T, opts = {}) {
  const units = opts.units || ((i, p) => (T.claims && T.claims[i] && T.claims[i][p]) || 0);
  const isOut = opts.isOut || ((i, p) => !!(T.out && T.out[i] && T.out[i][p]));
  const modeOf = opts.modeOf || ((it) => (it.qty < 2 ? 'share' : (T.modes && T.modes[it.id]) || 'count'));
  const even = T.mode === 'even';
  const ppl = people(T);
  const byId = {};
  ppl.forEach((p) => { byId[p.id] = { p, sub: 0, lines: [] }; });
  const info = {};
  let claimed = 0;
  for (const it of T.items || []) {
    const m = even ? 'share' : modeOf(it);
    const ent = even
      ? ppl.filter((p) => !isOut(it.id, p.id)).map((p) => [p.id, 1])
      : ppl.map((p) => [p.id, units(it.id, p.id)]).filter(([, u]) => u > 0);
    const tot = ent.reduce((s, [, u]) => s + u, 0);
    const out = {};
    let c = 0, over = 0, left;
    if (!ent.length) left = m === 'count' ? it.qty : 1;
    else if (m === 'count' && tot <= it.qty) {
      const unit = it.cents / it.qty;
      ent.forEach(([p, u]) => { out[p] = u * unit; });
      c = tot * unit; left = it.qty - tot;
    } else {
      ent.forEach(([p, u]) => { out[p] = (it.cents * u) / tot; });
      c = it.cents; left = 0;
      if (m === 'count') over = tot - it.qty;
    }
    const same = ent.every(([, u]) => u === (ent[0] || [0, 0])[1]);
    info[it.id] = { m, ent, tot, out, c, over, left, done: ent.length > 0 && left === 0 };
    claimed += c;
    ent.forEach(([p, u]) => {
      byId[p].sub += out[p];
      byId[p].lines.push({ item: it.id, label: lineLabel(it, m, u, ent.length, tot, same), amt: out[p] });
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
