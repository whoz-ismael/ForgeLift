# ForgeLift

A gym workout tracker — log the weight and reps of every set on each strength machine (or time, distance and calories on cardio machines), mark favorites, and watch your numbers climb over time. **Nothing-style** UI: dot-matrix type, monochrome black/white, single red accent, dark + light mode.

The original Claude Design prototype has been brought to life as a **real, runnable web app** built with plain **HTML, CSS and vanilla JS** — no build step, no framework. Accounts and workout history live in a **Supabase** (Postgres) database, so your data follows you across devices and browsers.

## Run it

Open `index.html` in any modern browser — that's it.

Or serve it locally (so `file://` quirks never bite):

```bash
npm start          # → npx serve .  (any static server works)
```

Log in with a **username + a 4-digit PIN**. A new name creates an account — seeded with the machine catalog — and sets its PIN; logging in again with that name requires the same PIN and restores the account's saved data from Supabase.

> **No setup needed to run it.** The app ships with the project's public Supabase URL + anon key baked into `js/supabase.js`, so opening `index.html` just works. To point it at your own Supabase project, edit those two constants and apply `supabase/migrations/0001_accounts.sql`.

## The app

| File | What it is |
|------|------------|
| `index.html` | App entry point. |
| `css/styles.css` | Design tokens, light/dark themes, responsive phone-on-desktop frame. |
| `js/app.js` | All app logic — state, screens, rendering, charts, icons. |
| `js/supabase.js` | Supabase client + the `ForgeLiftDB` data layer (login / signup / save / delete). |
| `supabase/migrations/` | SQL schema — the `accounts` table and PIN-verified RPCs. |
| `assets/` | Brand assets — `forgelift-icon-dark.png`, `-light.png` (1024px), `forgelift-icon.svg`, `forgelift-mark.svg`. |
| `test-smoke.js` | Headless jsdom smoke test covering the main flows against an in-memory mock of the data layer (`npm test`). |

## Features

- **Login** — username + PIN pad (visual demo gate; see *Notes*).
- **Machines** grouped by muscle group plus a **Cardio** category, with favorites and search. A broad starter catalog (chest, back, legs, shoulders, arms, core and cardio).
- **Per-machine line illustrations** (dot-matrix, theme-aware, generated in JS) — including cardio icons (treadmill, bike, rower, stairs…).
- **Context-aware logging** — strength machines use +/− steppers for reps & weight; **cardio machines** (treadmill, bike, elliptical, rower…) drop reps/weight and log **duration, distance & calories** instead. Distance follows your unit (km / mi). "Duplicate last", save session.
- **Progress chart** — max weight per session for strength, longest duration per session for cardio (inline SVG).
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

## Data & storage

Each account is a single row in the Supabase `accounts` table (`machines`, `logs`, `unit`, `theme` as JSON). The browser never touches the table directly — it calls four PIN-verified Postgres functions (`fl_login`, `fl_signup`, `fl_save`, `fl_delete`) defined in `supabase/migrations/0001_accounts.sql`. The table has Row Level Security enabled with **no policies**, so the public anon key can't read or write it except through those functions, and PINs are stored only as bcrypt hashes (`pgcrypto`) server-side.

This is a lightweight gate, not bank-grade auth: the functions are intentionally callable with the anon key (that's how a build-step-free, key-in-the-browser app reaches the DB), so a 4-digit PIN is the only barrier per username. Fine for a personal tracker — see *next steps* to harden it.

## Notes / next steps

- Move to full **Supabase Auth** (email / OAuth) and per-user RLS policies instead of the PIN gate + service functions.
- Rate-limit login attempts to blunt PIN brute-forcing.
- Cloud storage (Supabase Storage) for machine photos — they're currently inlined as data URLs in the row.
- Optional: package as an installable PWA.

## Design tokens

- Accent red `#D71921` / icons `#E10D1C`
- Dark: bg `#000`, surface `#0f0f0f`, border `#262626`, text `#fff`, muted `#7d7d7d`
- Light: bg `#f4f4f2`, surface `#fff`, border `#dddcd7`, text `#0a0a0a`, muted `#9a9a94`
- Type: **Doto** (dot-matrix display/numerals), **Space Mono** (labels/body)
