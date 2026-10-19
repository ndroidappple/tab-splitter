// Turns a tab's event log into the step 2 milestones and success metrics.
// Read it at /api/report?key=<REPORT_KEY>.

import { PAYER, TOTAL, compute } from '../../public/split.mjs';
import { BILL_KEY, read } from './core.mjs';

const MIN = 60 * 1000;
const SLACK = 100; // cents: within $1 counts as the right amount

export const TARGETS = {
  minutes_to_settled: 'median under 24 hours; every tab under 72 hours',
  share_paid_within_2h: '80% or more',
  reminders: 'median 0, never above 1',
  left_on_payer: '$0',
  payments_within_1: '95% or more',
  totals_moved_after_paying: '0',
  claim_fixes_after_all_claimed: '2 or fewer',
  unconfirmed_venmo_taps: 'under 10%',
  adds_up_to_cent: 'true on every tab',
};

const iso = (t) => (t == null ? null : new Date(t).toISOString());
const mins = (a, b) => (a == null || b == null ? null : Math.round(((b - a) / MIN) * 10) / 10);
const dollars = (c) => Math.round(c) / 100;
const first = (events, test) => { const e = events.find(test); return e ? e.t : null; };

export function buildReport(d) {
  const log = Array.isArray(d.log) ? d.log : [];
  const C = compute(d);
  const start = first(log, (e) => e.type === 'link_opened');

  // Which phones belong to whom: the device a person joined from.
  const devicesOf = {};
  for (const e of log) if (e.type === 'joined' && e.device) (devicesOf[e.person] ||= new Set()).add(e.device);

  const people = C.res.filter((r) => r.p.id !== PAYER).map((r) => {
    const id = r.p.id, devs = devicesOf[id] || new Set();
    const opened = first(log, (e) => e.type === 'link_opened' && (e.person === id || (e.device && devs.has(e.device))));
    const joined = first(log, (e) => e.type === 'joined' && e.person === id);
    const firstClaim = first(log, (e) => e.type === 'claim' && e.person === id && e.to > e.from);
    const payTapped = first(log, (e) => e.type === 'pay_tapped' && e.person === id);
    const paid = first(log, (e) => e.type === 'paid' && e.person === id);
    return {
      name: r.p.name,
      opened: iso(opened), joined: iso(joined), first_claim: iso(firstClaim), pay_tapped: iso(payTapped), paid: iso(paid),
      minutes_open_to_paid: mins(opened, paid),
      claimed_by_someone_else: log.some((e) => e.type === 'claim' && e.person === id && e.by && e.by !== id),
      total: dollars(r.total),
      paid_amount: r.p.paid == null ? null : dollars(r.p.paid),
      still_owes: dollars(Math.max(0, r.owed)),
    };
  });

  const milestones = {};
  const mark = (name, t) => { milestones[name] = { at: iso(t), minutes_from_start: mins(start, t) }; };
  mark('link_opened', start);
  mark('joined', first(log, (e) => e.type === 'joined'));
  mark('first_claim', first(log, (e) => e.type === 'claim' && e.to > e.from));
  mark('all_claimed', first(log, (e) => e.type === 'all_claimed'));
  mark('all_paid', first(log, (e) => e.type === 'all_paid'));

  // Money marked paid within 2 hours of the link first opening, as a share of what friends owe.
  const others = C.res.filter((r) => r.p.id !== PAYER);
  let early = 0;
  if (start != null) {
    for (const r of others) {
      const within = log.filter((e) => e.type === 'paid' && e.person === r.p.id && e.t - start <= 120 * MIN);
      if (within.length) early += Math.min(within.at(-1).amount || 0, r.total);
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
    left_on_payer: dollars(Math.max(0, C.unassigned)),
    payments_within_1: payers.length ? Math.round((payers.filter((r) => Math.abs(r.owed) <= SLACK).length / payers.length) * 100) / 100 : null,
    totals_moved_after_paying: log.filter((e) => e.type === 'total_moved').length,
    claim_fixes_after_all_claimed: allClaimedAt == null ? null : log.filter((e) => e.type === 'claim' && e.t > allClaimedAt).length,
    unconfirmed_venmo_taps: taps.length ? Math.round((unconfirmed.length / taps.length) * 100) / 100 : null,
    adds_up_to_cent: C.openItems.length ? null : C.assigned === TOTAL,
  };

  return { tab: BILL_KEY, generated_at: new Date().toISOString(), milestones, metrics, targets: TARGETS, people, events: log.length };
}

export async function handleReport(req, store, key) {
  const headers = { 'content-type': 'application/json', 'cache-control': 'no-store' };
  if (!key) return new Response(JSON.stringify({ error: 'The report is off. Set REPORT_KEY in Netlify to turn it on.' }), { status: 404, headers });
  if (new URL(req.url).searchParams.get('key') !== key) return new Response(JSON.stringify({ error: 'Wrong key' }), { status: 403, headers });
  const { data } = await read(store);
  return new Response(JSON.stringify(buildReport(data), null, 2), { headers });
}
