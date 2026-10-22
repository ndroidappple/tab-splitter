// Motion: the same four springs GymBuddy uses (ironlog src/lib/motion.js), for a page without React.
// Each spring is named for what moves. f is how quick (Hz); z is the damping: 1 settles without
// overshoot, lower lands with a little give. Whole surfaces get slower springs than the small things
// on them. CSS gets each as a linear() easing and a duration (--enter, --enter-ms, ...); a browser
// without linear() gets a close cubic-bezier instead.
const SPRINGS = {
  enter: { f: 3.6, z: 1, fallback: 'cubic-bezier(.16, 1, .3, 1)' },     // content arriving
  pop: { f: 3, z: 0.7, fallback: 'cubic-bezier(.2, 1.5, .4, 1)' },      // small things landing, presses letting go
  slide: { f: 3.4, z: 0.78, fallback: 'cubic-bezier(.3, 1.3, .5, 1)' }, // controls moving across
  surface: { f: 1.9, z: 0.9, fallback: 'cubic-bezier(.2, 1, .3, 1)' },  // sheets, screens, the dock
};
// Exits run quicker than entrances and speed up as they go, so closing feels immediate.
const EXIT_MS = 200, EXIT_EASE = 'cubic-bezier(.4, 0, 1, 1)';

/** Closed-form step response of a damped spring released at 0 and settling on 1, t in seconds. */
function spring(t, f, z) {
  if (t <= 0) return 0;
  const w = 2 * Math.PI * f;
  if (z >= 1) return 1 - Math.exp(-w * t) * (1 + w * t);
  const wd = w * Math.sqrt(1 - z * z);
  return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + (z * w / wd) * Math.sin(wd * t));
}
/** How long until the spring stays within 0.2% of where it lands, in whole ms. */
function settleMs(f, z) {
  let last = 0;
  for (let ms = 0; ms <= 3000; ms++) if (Math.abs(1 - spring(ms / 1000, f, z)) >= 0.002) last = ms;
  return last + 1;
}

const reduceQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
/** Reduce Motion is on (or the browser can't say): things land at once. */
export const still = () => !reduceQuery || reduceQuery.matches;

/** Puts the springs and the exit curve on :root for the stylesheet. With Reduce Motion every duration is 0. */
export function installMotion() {
  const linearOk = typeof CSS !== 'undefined' && CSS.supports && CSS.supports('transition-timing-function', 'linear(0, 1)');
  const s = document.documentElement.style;
  for (const [name, { f, z, fallback }] of Object.entries(SPRINGS)) {
    const ms = settleMs(f, z), steps = Math.ceil(ms / 10); // a point every ~10 ms keeps the curve smooth
    const ease = linearOk ? `linear(${Array.from({ length: steps + 1 }, (_, i) => (i === steps ? 1 : +spring((i / steps) * ms / 1000, f, z).toFixed(4))).join(', ')})` : fallback;
    s.setProperty(`--${name}`, ease);
    s.setProperty(`--${name}-ms`, `${still() ? 0 : ms}ms`);
  }
  s.setProperty('--exit', EXIT_EASE);
  s.setProperty('--exit-ms', `${still() ? 0 : EXIT_MS}ms`);
}

if (reduceQuery && reduceQuery.addEventListener) reduceQuery.addEventListener('change', installMotion);
// iOS Safari only applies :active (the press feedback) once the page listens for touches.
if (typeof document !== 'undefined') document.addEventListener('touchstart', () => {}, { passive: true });
