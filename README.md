# ForgeLift

A gym workout tracker — log the weight and reps of every set on each machine, mark favorites, and watch your max weight climb over time. **Nothing-style** UI: dot-matrix type, monochrome black/white, single red accent, dark + light mode.

The original Claude Design prototype has been brought to life as a **real, runnable web app** built with plain **HTML, CSS and vanilla JS** — no build step, no framework. Data lives in the browser (`localStorage`).

## Run it

Open `index.html` in any modern browser — that's it.

Or serve it locally (so `file://` quirks never bite):

```bash
npm start          # → npx serve .  (any static server works)
```

Log in with **any username + any 4-digit PIN**. A new name seeds a demo account pre-loaded with machines and progress history; an existing name restores that user's saved data.

## The app

| File | What it is |
|------|------------|
| `index.html` | App entry point. |
| `css/styles.css` | Design tokens, light/dark themes, responsive phone-on-desktop frame. |
| `js/app.js` | All app logic — state, screens, rendering, charts, icons, localStorage. |
| `assets/` | Brand assets — `forgelift-icon-dark.png`, `-light.png` (1024px), `forgelift-icon.svg`, `forgelift-mark.svg`. |
| `test-smoke.js` | Headless jsdom smoke test covering the main flows (`npm test`). |

## Features

- **Login** — username + PIN pad (visual demo gate; see *Notes*).
- **Machines** grouped by muscle group, with favorites and search.
- **Per-machine line illustrations** (dot-matrix, theme-aware, generated in JS).
- **Set logging** — +/− steppers for reps & weight, "duplicate last set", save session.
- **Progress chart** — max weight per session over time (inline SVG).
- **Add machine** with a photo from your gallery.
- **Settings** — light/dark theme, kg/lb units, logout.
- **Backup & restore** — export your account to a `.json` file and load it back later (move data between devices / keep a safety copy).
- **Delete account** — wipe a user's saved data from the device (with confirmation).
- **Responsive** — full-screen on phones, a centered phone frame on desktop.

## Backups

In **Settings → Data & Backup**:

- **Export** saves `forgelift-<user>-<date>.json` containing your machines, history, unit and theme.
  - On **iPhone/iPad**, Export opens the iOS share sheet — choose **Save to Files → iCloud Drive** and Apple syncs the backup across your devices (closest thing to a WhatsApp-style iCloud backup from a web app; the *when* is manual, the cross-device sync is automatic). Uses the [Web Share API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Share_API).
  - On **desktop / Android / unsupported browsers**, it falls back to a normal file download.
- **Restore** reads a backup file back and replaces the current account's data (asks for confirmation first; invalid files are rejected). On iOS the file picker can browse iCloud Drive, so you can restore the same file on another device.

Backups are plain JSON, so they're easy to inspect, archive, or sync yourself.

## Test

A headless [jsdom](https://github.com/jsdom/jsdom) smoke test drives the real flows (login → log a set → persist → add machine → settings → re-login):

```bash
npm install   # dev-only: jsdom
npm test
```

The app itself needs none of this — it runs from static files alone.

## Design reference (originals)

The source design files are kept for reference:

| File | What it is |
|------|------------|
| `ForgeLift.dc.html` | Editable Claude Design Component (template + logic). |
| `ForgeLift.html` | Self-contained bundled build of the prototype. |
| `ForgeLift Logo.html` | Brand sheet (app icon, wordmark, sizes). |
| `ios-frame.jsx`, `support.js` | Runtime + iPhone frame used by the source component. |

## Notes / next steps

This is a front-end app — auth, data and photos all live in `localStorage`, there is no backend. To take it further:

- Real authentication + hashed PINs (replace the visual PIN gate).
- A database keyed per user (replace `localStorage`).
- Cloud storage for machine photos.
- Optional: package as an installable PWA.

## Design tokens

- Accent red `#D71921` / icons `#E10D1C`
- Dark: bg `#000`, surface `#0f0f0f`, border `#262626`, text `#fff`, muted `#7d7d7d`
- Light: bg `#f4f4f2`, surface `#fff`, border `#dddcd7`, text `#0a0a0a`, muted `#9a9a94`
- Type: **Doto** (dot-matrix display/numerals), **Space Mono** (labels/body)
