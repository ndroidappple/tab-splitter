# Oct 17 tab

Live bill splitter. Friends tap their name, claim what they had, and pay Nick on Venmo. Everyone's phone stays in sync.

## Put it online (one time, about 3 minutes)

Netlify's drag-and-drop doesn't run the sync function, so deploy from Terminal instead. You need Node.js 18 or newer (from nodejs.org).

```
cd ~/Downloads/tab-split
npm install
npx netlify-cli deploy --prod
```

- The first run opens your browser to log in to Netlify.
- When it asks about linking, choose **Create & configure a new project** and give it a name, like `oct17-tab`.
- It prints your live URL when it finishes. Text that link to the group.

## What's where

- `public/index.html`: the page
- `netlify/functions/tab.mjs` + `netlify/lib/core.mjs`: the sync API at `/api/tab`. It stores the tab in Netlify Blobs and uses conditional writes, so simultaneous taps never overwrite each other.
- The Venmo username (`nick-szambelan`) and the payer (Nick) are fixed in the code, so nobody can change them from the page.
