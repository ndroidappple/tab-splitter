// The bill and the split math, shared by the page and the server so both
// always compute the same totals. Amounts are in cents.

export const PAYER = 'nick';

export const ITEMS = [
  {id:'bloody',   name:'Bloody Mary',                       qty:1, cents:1000, cat:'Drinks'},
  {id:'mojito',   name:'Door County Cherry Mojito',         qty:3, cents:3000, cat:'Drinks'},
  {id:'vacay',    name:'Vacationland, Door County Brewing', qty:1, cents:600,  cat:'Drinks'},
  {id:'lemonade', name:'Cherry Lemonade',                   qty:2, cents:1800, cat:'Drinks'},
  {id:'carbliss', name:'Carbliss',                          qty:7, cents:4200, cat:'Drinks'},
  {id:'shandy',   name:'Linneys Summer Shandy',             qty:1, cents:600,  cat:'Drinks'},
  {id:'mule',     name:'Cherry Mule',                       qty:2, cents:2000, cat:'Drinks'},
  {id:'cow',      name:'Spotted Cow',                       qty:9, cents:4500, cat:'Drinks'},
  {id:'miller',   name:'Miller Light Draft',                qty:1, cents:300,  cat:'Drinks'},
  {id:'rumple',   name:'Rumpleminz',                        qty:4, cents:1200, cat:'Drinks'},
  {id:'fireball', name:'Fireball',                          qty:3, cents:900,  cat:'Drinks'},
  {id:'curds',    name:'Cheese Curds',                      qty:3, cents:2685, cat:'Food', def:'share'},
  {id:'csalad',   name:'Doco Cherry Salad',                 qty:1, cents:1995, cat:'Food'},
  {id:'wrap',     name:'Fire Chicken Wrap',                 qty:1, cents:1495, cat:'Food'},
  {id:'wings',    name:'Chicken Wings (12)',                qty:1, cents:1495, cat:'Food'},
  {id:'hsalad',   name:'House Salad',                       qty:1, cents:1295, cat:'Food'},
  {id:'pork',     name:'DoCo Pulled Pork',                  qty:1, cents:1295, cat:'Food'},
  {id:'fish',     name:'Fish and Chips',                    qty:2, cents:3390, cat:'Food'},
  {id:'philly',   name:'Philly Cheese Steak',               qty:1, cents:1695, cat:'Food'},
];
export const SUB = 35445, TAX = 901, FEE = 1063, TIP = 7089, TOTAL = 44498, FEES = TAX + FEE;

// item id -> quantity on the receipt (the server uses this to validate requests)
export const ITEM_QTY = Object.fromEntries(ITEMS.map(i => [i.id, i.qty]));

// Everyone on the tab, payer first, then in the order they joined.
export function people(S){
  return Object.entries(S.people).map(([id, v]) => Object.assign({ id }, v))
    .sort((a, b) => a.id === PAYER ? -1 : b.id === PAYER ? 1 : (a.t || 0) - (b.t || 0));
}

function lineLabel(it, m, u, ent, tot, even){
  if (m === 'count' && tot <= it.qty) return `${it.name} ×${u}`;
  if (m === 'count') return `${it.name} ×${u} (${tot} claimed, ${it.qty} on bill)`;
  if (ent.length === 1) return it.name;
  return even ? `${it.name}, split ${ent.length} ways` : `${it.name}, ${u} of ${tot} shares`;
}

// Works out what everyone owes. The page passes its own `units` and `modeOf`
// so taps that haven't synced yet show up right away; the server uses the
// saved state as it is.
export function compute(S, opts = {}){
  const units = opts.units || ((i, p) => (S.claims[i] && S.claims[i][p]) || 0);
  const modeOf = opts.modeOf || (it => it.qty < 2 ? 'share' : (S.modes[it.id] || it.def || 'count'));
  const ppl = people(S), N = ppl.length;
  const byId = {};
  ppl.forEach(p => byId[p.id] = { p, sub:0, lines:[] });
  const info = {};
  let claimed = 0;
  for (const it of ITEMS){
    const m = modeOf(it);
    const ent = ppl.map(p => [p.id, units(it.id, p.id)]).filter(([, u]) => u > 0);
    const tot = ent.reduce((s, [, u]) => s + u, 0);
    const out = {};
    let c = 0, over = 0, left;
    if (!ent.length) left = m === 'count' ? it.qty : 1;
    else if (m === 'count' && tot <= it.qty){
      const unit = it.cents / it.qty;
      ent.forEach(([p, u]) => out[p] = u * unit);
      c = tot * unit; left = it.qty - tot;
    } else {
      ent.forEach(([p, u]) => out[p] = it.cents * u / tot);
      c = it.cents; left = 0;
      if (m === 'count') over = tot - it.qty;
    }
    const even = ent.every(([, u]) => u === (ent[0] || [0, 0])[1]);
    info[it.id] = { m, ent, tot, out, c, over, left, even, done: ent.length > 0 && left === 0 };
    claimed += c;
    ent.forEach(([p, u]) => { byId[p].sub += out[p]; byId[p].lines.push({ label:lineLabel(it, m, u, ent, tot, even), amt:out[p] }); });
  }
  const leftover = SUB - claimed > 0.5 ? SUB - claimed : 0;
  if (S.leftover === 'split' && N && leftover){
    const share = leftover / N;
    ppl.forEach(p => { byId[p.id].sub += share; byId[p.id].lines.push({ label:'Share of unclaimed items', amt:share }); });
  }
  const res = ppl.map(p => {
    const r = byId[p.id];
    r.fees = r.sub * FEES / SUB;
    r.tip = S.tip === 'even' ? TIP / N : r.sub * TIP / SUB;
    r.exact = r.sub + r.fees + r.tip;
    return r;
  });
  // Round to cents so everyone's totals add up exactly (largest remainder)
  const target = Math.round(res.reduce((t, r) => t + r.exact, 0));
  const cents = res.map(r => Math.floor(r.exact + 1e-9));
  let rem = target - cents.reduce((a, b) => a + b, 0);
  res.map((r, i) => [i, r.exact - Math.floor(r.exact + 1e-9)]).sort((a, b) => b[1] - a[1])
     .forEach(([i]) => { if (rem > 0){ cents[i]++; rem--; } });
  res.forEach((r, i) => {
    r.total = cents[i];
    r.subR = Math.round(r.sub); r.feesR = Math.round(r.fees); r.tipR = r.total - r.subR - r.feesR;
    r.owed = r.p.id === PAYER ? 0 : r.total - (r.p.paid || 0);
  });
  const others = res.filter(r => r.p.id !== PAYER);
  const collected = others.reduce((s, r) => s + (r.p.paid || 0), 0);
  const expected = others.reduce((s, r) => s + r.total, 0);
  const assigned = res.reduce((s, r) => s + r.total, 0);
  const openItems = ITEMS.filter(it => !info[it.id].done);
  return { ppl, res, byId, info, claimed, leftover, collected, expected, assigned, unassigned:TOTAL - assigned, openItems };
}
