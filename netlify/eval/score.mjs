// Scores one scanned receipt against its hand label.

const close = (a, b) => a != null && b != null && Math.abs(a - b) < 0.005;
const words = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/['’]/g, '')
  .split(/[^a-z0-9]+/).filter(Boolean);
// Share of the label's words that appear in the scanned name.
function nameMatch(truth, got) {
  const t = words(truth), g = new Set(words(got));
  if (!t.length) return 0;
  return t.filter((w) => g.has(w) || [...g].some((x) => x.length > 3 && (x.startsWith(w) || w.startsWith(x)))).length / t.length;
}

export function score(truth, got) {
  const items = Array.isArray(got && got.items) ? got.items : [];
  const used = new Set();
  const missed = [];
  let correct = 0;
  for (const [name, qty, price] of truth.items) {
    const k = items.findIndex((it, i) => !used.has(i) && close(Number(it.price), price) &&
      (qty == null || Number(it.quantity ?? 1) === qty) && nameMatch(name, it.name) >= 0.5);
    if (k >= 0) { used.add(k); correct++; } else missed.push(name);
  }
  const extras = items.filter((_, i) => !used.has(i)).map((it) => `${it.quantity ?? '?'} ${it.name} ${it.price}`);

  // The app's own check: do the items (plus any fee printed among them) add up to the printed subtotal?
  const fees = Array.isArray(got && got.fees) ? got.fees : [];
  const sum = items.reduce((s, it) => s + Number(it.price || 0), 0) + fees.filter((f) => f.listed_with_items).reduce((s, f) => s + Number(f.amount || 0), 0);
  const printed = got && (got.subtotal ?? got.total);
  const appFlags = printed == null || Math.abs(sum - printed) >= 0.005;
  const allRight = correct === truth.items.length && extras.length === 0 && close(printed, truth.subtotal ?? truth.total);
  const reconcile = appFlags ? 'flagged' : allRight ? 'matched' : 'silent_miss';

  return {
    items_correct: correct, items_truth: truth.items.length, extras: extras.length,
    reconcile,
    total_ok: close(got && got.total, truth.total),
    card_charge_ok: truth.card_charge == null ? null : close(got && got.card_charge, truth.card_charge),
    gratuity_ok: truth.gratuity == null ? !(got && got.gratuity) : close(got && got.gratuity, truth.gratuity),
    missed, extra_items: extras,
  };
}
