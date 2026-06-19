# ForgeLift

A gym workout tracker — log the weight and reps of every set on each machine, mark favorites, and watch your max weight climb over time. **Nothing-style** UI: dot-matrix type, monochrome black/white, single red accent, dark + light mode.

> ⚠️ **This is a front-end design prototype**, not a production app. Auth, data and photos live in the browser (`localStorage`) — there is no backend yet. See *Next steps* below.

## What's here

| File | What it is |
|------|------------|
| `ForgeLift.dc.html` | **Source** — the editable Design Component (template + logic). |
| `ForgeLift.html` | **Bundled build** — self-contained, open it directly in any browser. |
| `ForgeLift Logo.html` | Brand sheet (app icon, wordmark, sizes). |
| `assets/` | Logo assets — `forgelift-icon-dark.png`, `-light.png` (1024px), `forgelift-icon.svg`, `forgelift-mark.svg`. |
| `ios-frame.jsx`, `support.js` | Runtime + iPhone frame used by the source component. |

## Run it

Just open `ForgeLift.html` in a browser. Log in with any username + any 4-digit PIN (a demo account comes pre-seeded with progress data).

## Features

- **Login** — username + PIN pad.
- **Machines** grouped by muscle group, with favorites and search.
- **Per-machine line illustrations** (dot-matrix, theme-aware).
- **Set logging** — +/− steppers for reps & weight, "duplicate last set", save session.
- **Progress chart** — max weight per session over time.
- **Add machine** with a photo from your gallery.
- **Settings** — light/dark theme, kg/lb units, logout.

## Next steps (to make it a real app)

- Real authentication + hashed PINs (replace the visual PIN gate).
- A database keyed per user (replace `localStorage`).
- Cloud storage for machine photos.
- Recreate the UI in a real framework (React/Vue/SwiftUI…) using these HTML files as the visual reference.

## Design tokens

- Accent red `#D71921` / icons `#E10D1C`
- Dark: bg `#000`, surface `#0f0f0f`, border `#262626`, text `#fff`, muted `#7d7d7d`
- Light: bg `#f4f4f2`, surface `#fff`, border `#dddcd7`, text `#0a0a0a`, muted `#9a9a94`
- Type: **Doto** (dot-matrix display/numerals), **Space Mono** (labels/body)
