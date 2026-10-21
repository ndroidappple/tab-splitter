# Tab UI plan: GymBuddy's motion, Tab's own look

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
| 9 | Fold away with `collapse()`, glide with FLIP | `motion.js`, swipe-to-delete in `Session.jsx` | Removed people and receipt lines; rows moving between Needs someone and Claimed |
| 10 | A sheet to confirm, never a browser dialog | `ConfirmSheet` | Close the tab |
| 11 | No pop-in: what's already known draws on the first frame, and updates arrive in place | commit 6ca89ab | Polling updates and other people's claims |

Left out on purpose: coaches, GymBuddy's look (Lexend, thick drop lips, day colors), help tap-through cards, hold to edit, sounds (the earshot branch isn't merged in GymBuddy either) and a tab bar. Friends use Tab once per dinner and need to finish in under a minute.

## What makes Tab its own

- **The list is the receipt.** A paper strip with torn edges, dotted leaders, mono prices, and the server, table and check line.
- **A highlighter marks what you had**, in your color. It draws in on the slide spring and erases on the exit curve.
- **A PAID stamp** lands on the pop spring when you pay, and on a person's card for the host.
- **A scan line** passes over the receipt while it's read, and the lines appear as they're read.
- **A tear-off total.** The dock is the bottom of the receipt.
- Type: Bricolage Grotesque for the interface, IBM Plex Mono for money and receipt lines. The slate neutrals and the 12 person colors stay.

## Behaviour changes that come with it

- **Rows don't move under your thumb.** A ticked row stays put. About 1.4 s after the last tap, rows glide to their group. Polling updates don't regroup while someone is tapping.
- **Undo instead of `confirm()`.** Remove person: the card folds away and an Undo toast shows. The `remove` call is sent when the toast expires, so the server needs no new op. Close the tab: a confirm sheet.
- **Back works.** `popstate` reloads the page today (`app.mjs:906`). Setup steps and People ⇄ Items should push history entries the way GymBuddy's router does, so back slides back.

## Build order

Each phase ships on its own, behind a Netlify deploy preview.

1. **Motion foundation.** `public/motion.mjs`: springs, `anim()`, `collapse()`/`expand()`, `roll()`, and keyed `patch()` with FLIP. Add press feedback CSS and reduced-motion handling. Users see no change in behaviour.
2. **Sheets and toasts.** Animated open and close, drag to close, keyboard-aware. Toast with swipe and Undo. Replace both `confirm()` calls.
3. **Items list.** Render rows by key with `patch()`, so a tap updates one row instead of the whole list. Add the deferred regroup with FLIP, the rolling dock total, tick and slot pops, and the quiet pulse for other people's changes.
4. **Screens.** View transitions for setup, join and People ⇄ Items. Sliding pill. History entries instead of reloading.
5. **Look.** Receipt strip, highlighter, stamp, scan line, tear-off dock and fonts. Self-host the two fonts in `public/fonts` or load them from Google Fonts; the page has no third-party requests today.

## Things to watch

- **Tests.** `tests/page.mjs` runs in jsdom, which has no `matchMedia`, `Element.animate`, `getAnimations`, `startViewTransition` or `visualViewport`. `motion.mjs` has to treat a missing API as "no motion" and change the DOM at once, so sheets close synchronously in tests. The test that clicks Close the tab will need to tap the confirm sheet's button. The selectors (`data-act`, `data-i`, `data-p`, `data-k`) stay the same.
- **Browsers.** Screen transitions need iOS 18 or later. `linear()` springs need iOS 17.2 or later; older phones get the cubic-bezier fallbacks. Everything else uses Web Animations, which older iPhones support.
- **Re-renders.** Polling every 3 s rebuilds `#app` whenever the HTML changes. Keyed rows keep unchanged rows (and their running animations and focus) in place.
- **Copy.** Undo makes remove and close reversible, so "Removed" and "Tab closed" toasts need an Undo button, not a second question.

## Open questions for feedback

1. Is the receipt look right for Tab, or should Tab stay closer to today's plainer cards and take only the motion?
2. Should rows wait and then glide (9), or regroup only when you leave the Items view?
3. Should remote changes stay silent, or should a friend see a toast like "Ben took a Spotted Cow"? The host already gets "Ben paid you $23.86".
