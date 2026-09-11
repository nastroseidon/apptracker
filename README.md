# AppCull

A phone-sized web app that tells you which iPhone apps are worth deleting.

You feed it the app list your iPhone already keeps in **Settings → General → iPhone
Storage** — name, size, last-used date — and it ranks everything by how little you'd
miss it. It does not delete anything. Deleting stays your finger on the Home screen;
AppCull's job is deciding *what*.

Runs offline, installs to the Home screen, and keeps every byte of data in your
browser. There is no server and no account.

## Why it isn't a native app

Worth being blunt, because it shaped the whole design: **iOS does not let any
third-party app read per-app usage.** The Screen Time (`DeviceActivity`) API only
renders usage inside Apple's own sealed report view — your code can't read the
numbers, the app names, or the bundle IDs, which arrive as opaque tokens. There is no
"last used" API at all, and no API to uninstall another app. A native Swift app would
be able to do strictly *less* than this page.

But the data you want does exist on the phone — it's just in Settings, as text. So
AppCull reads it the one way that works: you copy it out and paste it in.

## Getting it onto your iPhone

Any static host works (GitHub Pages, Netlify, or a laptop on the same Wi-Fi).

```bash
git clone https://github.com/<you>/appcull.git
cd appcull
npx serve .          # or: python3 -m http.server 8000
```

Open the URL in **Safari** on the phone, tap Share → **Add to Home Screen**. It then
launches full-screen and works with no connection.

Safari is required for install — Chrome on iOS can't add PWAs to the Home Screen.

## Getting your app list in

1. On the iPhone: **Settings → General → iPhone Storage**. Let the list finish loading.
2. Screenshot it. Scroll, screenshot again, until you've covered the whole list.
3. Open a screenshot in Photos, tap the **Live Text** button in the bottom-right,
   **Select All**, **Copy**.
4. In AppCull, go to **Import** and paste. Repeat per screenshot — re-importing an app
   updates it rather than duplicating it.

The parser is deliberately forgiving, because Live Text scrambles the column order. It
copes with `Instagram / 1.24 GB / Last Used: 8/3/25`, with the size glued onto the name
line, with `Never Used`, and with `Today` / `Yesterday` / `Aug 3, 2025` / `8/3/25`. It
throws away the storage-screen chrome (`iOS`, `System Data`, `Show All`, the legend
rows). Anything it garbles you can fix by hand in **Library**.

## How the verdict is decided

Each app gets a 0–100 cull score, weighted **72% staleness, 28% size**:

- **Staleness** is 0 for anything opened in the last two weeks, then ramps linearly to
  1 at a year untouched. Never-opened sits at the ceiling, plus a small bonus so it
  outranks apps you opened once and abandoned.
- **Size** is a log curve — 2 GB reads as "big", 20 MB barely registers — so a huge app
  never gets condemned on size alone.

That lands each app in one of three buckets:

| Bucket | Rule | What to do |
|---|---|---|
| **Delete** | score ≥ 55 and unopened for 90+ days | Remove it; you won't miss it |
| **Offload** | ≥ 300 MB and unopened for 30+ days | Settings → the app → **Offload App**: frees the space, keeps your documents and data, leaves the icon |
| **Keep** | everything else, plus anything pinned | Leave it alone |

Pin an app to take it off the table permanently — pinned apps are never suggested for
deletion regardless of score.

**Triage** walks you through the queue one card at a time, highest score first, with
the reasoning spelled out. Mark each as deleted or kept; it remembers, so you can put
the phone down and pick it back up.

## Tests

```bash
node --test
```

Covers the Live Text parser (date formats, scrambled column order, chrome filtering)
and the scoring buckets. No dependencies.

## Data

Everything lives in one `localStorage` key. **Import → Export JSON** writes a backup;
**Erase all data** clears it. Nothing is ever sent anywhere — there's nothing to send
it to.

Clearing Safari's website data will wipe it, so export before you do that.
