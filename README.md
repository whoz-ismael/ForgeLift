# ForgeLift

A gym workout tracker — log the weight and reps of every set on each strength machine (or time, distance and calories on cardio machines), mark favorites, and watch your numbers climb over time. **Nothing-style** UI: dot-matrix type, monochrome black/white, single red accent, dark + light mode.

The original Claude Design prototype has been brought to life as a **real, runnable web app** built with plain **HTML, CSS and vanilla JS** — no build step, no framework. Accounts and workout history live in a **Supabase** (Postgres) database, so your data follows you across devices and browsers.

## Run it

Serve it locally and open the printed URL:

```bash
npm start          # → npx serve .  (any static http server works)
```

> Use an **`http://` origin** (e.g. `localhost`), not `file://` — Supabase Auth and the OAuth redirect need a real origin.

**Sign in** with **Apple**, **Google**, or **email + password**. The first time you sign in, ForgeLift creates your profile (seeded with the machine catalog) and your data syncs from Supabase on every device you log in on.

> The app ships with the project's public Supabase URL + anon key in `js/supabase.js`, so it works out of the box once the providers are enabled (below). To use your own Supabase project, edit those two constants and apply the migrations in `supabase/migrations/`.

## Auth setup (one-time, in the Supabase dashboard)

Email/password works immediately. The social providers need credentials from each vendor — ForgeLift has the code wired up; you just enable them:

1. **Redirect URLs** — *Authentication → URL Configuration*: set **Site URL** and add your app origin (e.g. `http://localhost:3000`) to **Redirect URLs**.
2. **Google** — create an OAuth client in the [Google Cloud Console](https://console.cloud.google.com/apis/credentials), then paste its Client ID + Secret into *Authentication → Providers → Google* and enable it.
3. **Apple** — from your [Apple Developer](https://developer.apple.com/) account create a Services ID + key, then fill *Authentication → Providers → Apple* and enable it. (Requires a paid Apple Developer membership.)
4. **Email** — on by default. For instant sign-up during testing you can turn **off** *Confirm email* in *Authentication → Providers → Email*; otherwise new users must click the confirmation link before signing in.

Until a provider is enabled, its button shows a friendly "not enabled yet" message instead of breaking.

## The app

| File | What it is |
|------|------------|
| `index.html` | App entry point. |
| `css/styles.css` | Design tokens, light/dark themes, responsive phone-on-desktop frame. |
| `js/app.js` | All app logic — state, screens, rendering, charts, icons, session handling. |
| `js/supabase.js` | Supabase client + the `ForgeLiftAuth` layer (OAuth / email auth + profile load / save / delete). |
| `supabase/migrations/` | SQL schema — the `profiles` table and its per-user RLS policies. |
| `assets/` | Brand assets — `forgelift-icon-dark.png`, `-light.png` (1024px), `forgelift-icon.svg`, `forgelift-mark.svg`. |
| `test-smoke.js` | Headless jsdom smoke test covering the main flows against an in-memory mock of the data layer (`npm test`). |

## Features

- **Login** — real authentication via Supabase Auth: **Sign in with Apple**, **Google**, or **email + password**.
- **Machines** grouped by muscle group plus a **Cardio** category, with favorites and search. A broad starter catalog (chest, back, legs, shoulders, arms, core and cardio).
- **Per-machine line illustrations** (dot-matrix, theme-aware, generated in JS) — including cardio icons (treadmill, bike, rower, stairs…).
- **Context-aware logging** — strength machines use +/− steppers for reps & weight; **cardio machines** (treadmill, bike, elliptical, rower…) drop reps/weight and log **duration, distance & calories** instead. Distance follows your unit (km / mi). "Duplicate last", save session.
- **Progress chart** — max weight per session for strength, longest duration per session for cardio (inline SVG).
- **Add machine** with a photo from your gallery.
- **Settings** — light/dark theme, kg/lb units, the signed-in account, logout.
- **Backup & restore** — export your data to a `.json` file and load it back later (extra safety copy / manual transfer).
- **Delete account** — wipe your saved workout data from Supabase and sign out (with confirmation).
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

Authentication is handled by **Supabase Auth** — the browser holds a signed JWT for the logged-in user. Each user owns one row in the `profiles` table (`machines`, `logs`, `unit`, `theme` as JSON), keyed by their auth user id. **Row Level Security** policies (`auth.uid() = user_id`) mean every query the client makes is automatically scoped to that user: you can only ever read or write your own row, enforced by Postgres, not by app code. No secrets or other users' data are reachable with the public anon key.

The UI follows the session: `onAuthStateChange` drives the screens, so the app reacts to first load, the OAuth redirect, and sign in / out alike.

## Notes / next steps

- **Delete account** removes your `profiles` row (workout data) and signs you out; it doesn't delete the underlying auth user — signing back in gives you a fresh, freshly-seeded profile. Full user deletion needs a privileged server call (Edge Function with the service role).
- Cloud storage (Supabase Storage) for machine photos — they're currently inlined as data URLs in the row.
- Optional: package as an installable PWA.

## Design tokens

- Accent red `#D71921` / icons `#E10D1C`
- Dark: bg `#000`, surface `#0f0f0f`, border `#262626`, text `#fff`, muted `#7d7d7d`
- Light: bg `#f4f4f2`, surface `#fff`, border `#dddcd7`, text `#0a0a0a`, muted `#9a9a94`
- Type: **Doto** (dot-matrix display/numerals), **Space Mono** (labels/body)
