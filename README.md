# Oct 17 tab

Live bill splitter. Friends tap their name, claim what they had, and pay Nick on Venmo. Everyone's phone stays in sync.

## Put it online (from your phone)

1. Go to app.netlify.com and sign in.
2. Tap **Add new project → Import an existing project → GitHub**, allow access, and pick `oct17-tab`.
3. Leave every setting as it is (`netlify.toml` already has them) and tap **Deploy**.

In about a minute Netlify gives you a link. Text it to the group. Any later change pushed to this repo redeploys on its own.

## What's where

- `public/index.html`: the page
- `netlify/functions/tab.mjs` + `netlify/lib/core.mjs`: the sync API at `/api/tab`. It stores the tab in Netlify Blobs and uses conditional writes, so simultaneous taps never overwrite each other.
- The Venmo username (`nick-szambelan`) and the payer (Nick) are fixed in the code, so nobody can change them from the page.
