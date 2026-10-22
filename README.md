# Tab

Split any tab. The person who paid snaps the receipt, then assigns what they know and sends the link for the rest; everyone taps their name, claims what they had (or splits evenly minus what they skipped), and pays back on Venmo, Cash App, PayPal or Zelle in the same sitting. Tax, fees and tip are split in proportion to what each person had. Friends never need an account.

## Put it online (from your phone)

1. Go to app.netlify.com and sign in.
2. Tap **Add new project → Import an existing project → GitHub**, allow access, and pick this repo.
3. Leave every setting as it is (`netlify.toml` already has them) and tap **Deploy**.

Pushing to `main` redeploys to production (15 credits each on the free plan). Pull requests get a free preview link instead, so test there first.

## How it works

- `/` starts a new tab: take a photo of the receipt (or type it), check the lines and what your card was charged, add who was there, pick itemized or even split. The draft is saved as you type, and recent tabs are listed here.
- The host's Items view has a strip of names: tap one, then tap what they had. Tab settings change the name, the ways to pay, and whether friends see everyone's totals.
- `/t/<tab id>` is the tab everyone opens. `?p=<person>` opens straight to one person (the link in private reminders). `#h=<host key>` is the host's private link; it's saved on the host's phone.
- A person's total locks when they pay, so later changes can't move it. Anything nobody claimed stays "not covered" until the host assigns it, splits it across everyone who hasn't paid, or covers it.

## What's where

- `public/index.html`, `public/app.mjs`: the page
- `public/split.mjs`: the split math, shared by the page and the server so their totals always match
- `netlify/lib/core.mjs` + `netlify/functions/tab.mjs`: the tab API at `/api/tab` (Netlify Blobs, conditional writes)
- `netlify/lib/read-receipt.mjs`, `netlify/lib/scan.mjs` + `netlify/functions/scan.mjs`: receipt reading at `/api/scan`. Haiku 5.5 reads it; Sonnet 5 rereads only when the items don't add up to the subtotal. Receipt reading stops for the month at `SCAN_CREDIT_CAP` credits (default 30).
- `netlify/lib/report.mjs` + `netlify/functions/report.mjs`: the host's report at `/api/report` (event log turned into milestones and metrics; the tab's "See the report" button opens it)
- Deploy previews use their own storage, so trying a preview never changes live tabs.

## Tests

- `npm test`: plays tabs through the server code (host-only actions, locks, leftovers, even split, to-the-cent checks on 3,000 random tabs, receipt reading and the monthly cap).
- `npm i --no-save jsdom && npm run test:page`: drives the real page through a whole tab on three simulated phones.
