# Tab UI plan: GymBuddy's motion on today's cards

Prototype: `design/prototype.html` (open it in a browser). The published copy, which saves Keep / Tweak / Skip marks for Claude to read, is at https://claude.ai/artifact/LytnuvRCWzBxZUeCipahBP.

## What carries over from GymBuddy (ironlog)

GymBuddy's polish comes from a few systems, not one-off effects. Each one ports to Tab's plain-JS page.

| # | Pattern | GymBuddy source | Where it goes in Tab |
|---|---|---|---|
| 1 | Four named springs (enter, pop, slide, surface) as CSS `linear()` easings, plus quick accelerating exits | `src/lib/motion.js`, commit cc36bc1 | Everything. One `public/motion.mjs` sets them on `:root`. |
| 2 | Screens slide forward and back with view transitions; the old screen fades out in 120 ms so the two never ghost | `src/lib/router.js`, "Route transitions" in `styles.css` | Setup steps, picking your name, People ⇄ Items |
| 3 | Sliding pill on the slide spring | `TabBar` in `ui.jsx` | The People / Items switch |
| 4 | Sheets rise from the edge, follow a drag down, slide away however they close, and stay above the keyboard | `Sheet` in `ui.jsx`, commit a333abc | Every `<dialog class="sheet">` |
| 5 | Rolling numbers | `Roll.jsx`, commit f662376 | Dock total, paid-back total, group counts, stepper counts |
| 6 | Press feedback on every control: down in 70 ms, back on the pop spring | commit 4c9f6ab | Buttons, ticks, slots, rows, names |
| 7 | Checks and chips pop in | the pop spring | Ticks, slots, names added in setup |
| 8 | Small toast pill: rises, tap or swipe it away, plain-text Undo, 5 s for undo and 2.6 s otherwise | `Toast` in `ui.jsx`, commit a9fa7d6 | Replaces the two `confirm()` pop-ups and "Undo payment" |
| 9 | Fold away with `collapse()`, glide with FLIP | `motion.js`, swipe-to-delete in `Session.jsx` | Removed people and receipt lines; the cards below glide up |
| 10 | A sheet to confirm, never a browser dialog | `ConfirmSheet` | Close the tab |
| 11 | No pop-in: what's already known draws on the first frame, and updates arrive in place | commit 6ca89ab | Polling updates and other people's claims |

Left out on purpose: coaches, GymBuddy's look (Lexend, thick drop lips, day colors), help tap-through cards, hold to edit, sounds (the earshot branch isn't merged in GymBuddy either) and a tab bar. Friends use Tab once per dinner and need to finish in under a minute.

## Decisions (Oct 21)

- **Keep today's look.** Same cards, colors, system font and dock. Only the motion and the components above change. No receipt strip, highlighter, PAID stamp, scan line or new fonts.
- **Regroup only on arrival.** Items sort into Needs someone and Claimed when you come to the list (opening the tab, picking your name, switching from People). While you're on it, nothing moves: a ticked row keeps its place, its check and tint pop in, and the dock total rolls.
- **No toasts for other people's claims.** Their changes update the row in place with a short tint in their color. The host still gets a toast when someone pays.

## Behaviour changes that come with it

- **Undo instead of `confirm()`.** Remove person: the card folds away and an Undo toast shows. The `remove` call is sent when the toast expires, so the server needs no new op. Close the tab: a confirm sheet.
- **Back works.** `popstate` reloads the page today (`app.mjs:906`). Setup steps and People ⇄ Items should push history entries the way GymBuddy's router does, so back slides back.

## Build order

Four phases, each shipping on its own, behind a Netlify deploy preview.

1. **Motion foundation** (done). `public/motion.mjs` puts the springs on `:root`; presses on every control; the chevron and toast ride the springs; Reduce Motion zeroes every duration. `anim()`, `collapse()`/`expand()`, `roll()` and keyed `patch()` with FLIP join `motion.mjs` in the phases that first use them.
2. **Sheets and toasts** (done). Sheets rise, drag down to close, slide away however they close, and follow the keyboard. Toasts rise, tap or swipe away, and carry Undo for marking paid, undoing a payment and closing the tab. Remove person folds the card away and is sent when the Undo toast goes. Closing the tab asks in a sheet.
3. **Items list.** Render rows by key with `patch()`, so a tap updates one row instead of the whole list. Group rows when the list is opened, not on every render. Add the rolling dock total, tick and slot pops, and the quiet tint for other people's changes.
4. **Screens.** View transitions for setup, join and People ⇄ Items. Sliding pill. History entries instead of reloading.

## Things to watch

- **Tests.** `tests/page.mjs` runs in jsdom, which has no `matchMedia`, `Element.animate`, `getAnimations`, `startViewTransition` or `visualViewport`. `motion.mjs` has to treat a missing API as "no motion" and change the DOM at once, so sheets close synchronously in tests. The test that clicks Close the tab will need to tap the confirm sheet's button. The selectors (`data-act`, `data-i`, `data-p`, `data-k`) stay the same.
- **Browsers.** Screen transitions need iOS 18 or later. `linear()` springs need iOS 17.2 or later; older phones get the cubic-bezier fallbacks. Everything else uses Web Animations, which older iPhones support.
- **Re-renders.** Polling every 3 s rebuilds `#app` whenever the HTML changes. Keyed rows keep unchanged rows (and their running animations and focus) in place.
- **Copy.** Undo makes remove and close reversible, so "Removed" and "Tab closed" toasts need an Undo button, not a second question.
