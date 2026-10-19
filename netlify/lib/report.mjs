// Turns a tab's event log into the step 2 milestones and success metrics.
// The host opens it from the tab (it uses the host's private key).

import { HOST, compute } from '../../public/split.mjs';
import { read, hash, validId } from './core.mjs';

const MIN = 60 * 1000;
const SLACK = 100; // cents: within $1 counts as the right amount

export const TARGETS = {
  minutes_to_settled: 'median under 24 hours; every tab under 72 hours',
  share_paid_within_2h: '80% or more',
  reminders: 'fewer than about 5',
  left_on_payer: '$0',
  payments_within_1: '95% or more',
  claim_fixes_after_all_claimed: '2 or fewer',
  unconfirmed_venmo_taps: 'under 10%',
  adds_up_to_cent: 'true',
};

const iso = (t) => (t == null ? null : new Date(t).toISOString());
const mins = (a, b) => (a == null || b == null ? null : Math.round(((b - a) / MIN) * 10) / 10);
const dollars = (c) => Math.round(c) / 100;
const first = (events, test) => { const e = events.find(test); return e ? e.t : null; };

export function buildReport(T) {
  const log = Array.isArray(T.log) ? T.log : [];
  const C = compute(T);
  const start = first(log, (e) => e.type === 'link_opened') ?? first(log, (e) => e.type === 'created');
  const devicesOf = {};
  for (const e of log) if (e.type === 'joined' && e.device) (devicesOf[e.person] ||= new Set()).add(e.device);

  const people = C.res.filter((r) => r.p.id !== HOST).map((r) => {
    const id = r.p.id, devs = devicesOf[id] || new Set();
    const opened = first(log, (e) => e.type === 'link_opened' && (e.person === id || (e.device && devs.has(e.device))));
    const paid = first(log, (e) => e.type === 'paid' && e.person === id);
    return {
      name: r.p.name,
      opened: iso(opened), joined: iso(first(log, (e) => e.type === 'joined' && e.person === id)),
      first_claim: iso(first(log, (e) => e.type === 'claim' && e.person === id && e.to > e.from)),
      pay_tapped: iso(first(log, (e) => e.type === 'pay_tapped' && e.person === id)), paid: iso(paid),
      minutes_open_to_paid: mins(opened, paid),
      items_added_by_someone_else: log.some((e) => e.type === 'claim' && e.person === id && e.by && e.by !== id),
      reminders: log.filter((e) => e.type === 'nudge_sent' && e.to === id).length,
      total: dollars(r.total), paid_amount: r.p.paid == null ? null : dollars(r.p.paid), still_owes: dollars(Math.max(0, r.owed)),
    };
  });

  const milestones = {};
  const mark = (name, t) => { milestones[name] = { at: iso(t), minutes_from_start: mins(start, t) }; };
  mark('link_opened', start);
  mark('joined', first(log, (e) => e.type === 'joined'));
  mark('first_claim', first(log, (e) => e.type === 'claim' && e.to > e.from));
  mark('all_claimed', first(log, (e) => e.type === 'all_claimed'));
  mark('all_paid', first(log, (e) => e.type === 'all_paid'));

  const others = C.res.filter((r) => r.p.id !== HOST);
  let early = 0;
  if (start != null) {
    for (const r of others) {
      early += Math.min(r.total, log.filter((e) => e.type === 'paid' && e.person === r.p.id && e.t - start <= 120 * MIN).reduce((s, e) => s + (e.amount || 0), 0));
    }
  }
  const taps = log.filter((e) => e.type === 'pay_tapped' && e.person);
  const unconfirmed = taps.filter((tap) => !log.some((e) => e.type === 'paid' && e.person === tap.person && e.t >= tap.t && e.t - tap.t <= 10 * MIN));
  const payers = others.filter((r) => r.p.paid != null);
  const allClaimedAt = first(log, (e) => e.type === 'all_claimed');

  const metrics = {
    minutes_to_settled: milestones.all_paid.minutes_from_start,
    share_paid_within_2h: C.expected ? Math.round((early / C.expected) * 100) / 100 : null,
    reminders: log.filter((e) => e.type === 'nudge_sent').length,
    left_on_payer: dollars(Math.max(0, C.pool)),
    payments_within_1: payers.length ? Math.round((payers.filter((r) => Math.abs(r.total - r.p.paid) <= SLACK || r.settled).length / payers.length) * 100) / 100 : null,
    claim_fixes_after_all_claimed: allClaimedAt == null ? null : log.filter((e) => e.type === 'claim' && e.t > allClaimedAt).length,
    unconfirmed_venmo_taps: taps.length ? Math.round((unconfirmed.length / taps.length) * 100) / 100 : null,
    adds_up_to_cent: C.res.reduce((s, r) => s + r.total, 0) + C.pool === C.charge,
  };
  return { tab: T.id, title: T.title, generated_at: new Date().toISOString(), milestones, metrics, targets: TARGETS, people, events: log.length };
}

export async function handleReport(req, store) {
  const headers = { 'content-type': 'application/json', 'cache-control': 'no-store' };
  const q = new URL(req.url).searchParams;
  const id = q.get('t');
  if (!validId(id)) return new Response(JSON.stringify({ error: 'No such tab' }), { status: 404, headers });
  const cur = await read(store, id);
  if (!cur) return new Response(JSON.stringify({ error: 'No such tab' }), { status: 404, headers });
  if (hash(q.get('key') || '') !== cur.data.hostKeyHash) return new Response(JSON.stringify({ error: 'Only the host can see the report' }), { status: 403, headers });
  return new Response(JSON.stringify(buildReport(cur.data), null, 2), { headers });
}
