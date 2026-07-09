# Electron + Vercel deployment

## Architecture

| Layer | Host | Responsibility |
|-------|------|----------------|
| API | Vercel (`server-fn.ts` → `api/index.ts`) | Auth, orders, DB, print **job generation** (ESC/POS base64), Pusher publish |
| Web UI | Vercel static (`dist/public`) or Vite dev | Full app in browser; browser print / WebUSB fallback |
| Desktop | Electron (`desktop/`) | Same React UI; thermal/USB/network print via main process |

## Environment variables

### Vercel

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Neon Postgres |
| `SESSION_SECRET` | Session signing |
| `ALLOWED_ORIGINS` | Comma-separated CORS origins (Electron dev URL, custom admin host) |
| `PUSHER_APP_ID`, `PUSHER_KEY`, `PUSHER_SECRET`, `PUSHER_CLUSTER` | Realtime (optional but required for live updates on serverless) |
| `PUSHER_CHANNEL` | Default `bagicha-pos` |

### Client (`.env` / Vite)

| Variable | Purpose |
|----------|---------|
| `VITE_API_BASE_URL` | API origin when UI is not served from API (Electron, separate static host). Empty = same-origin `/api` |
| `VITE_PUSHER_KEY` | Public Pusher key (subscribe) |
| `VITE_PUSHER_CLUSTER` | e.g. `ap2` |
| `VITE_PUSHER_CHANNEL` | Must match server `PUSHER_CHANNEL` |

### Electron

| Variable | Purpose |
|----------|---------|
| `VITE_API_BASE_URL` / `API_BASE_URL` | Vercel API URL for print settings lookup in main process |
| `VITE_DEV_SERVER_URL` | Default `http://localhost:5173` for `npm run dev:electron` |

## Feature matrix

| Feature | Browser (Vercel UI) | Electron |
|---------|----------------------|----------|
| POS / orders / CRM | Yes | Yes |
| Session login (cross-origin) | Yes, with `ALLOWED_ORIGINS` + `SameSite=None` cookies | Yes |
| Live tables (Pusher) | Yes, with `VITE_PUSHER_KEY` | Yes |
| Live tables (local WS) | Dev only (UI served with `npm run dev`) | Dev only |
| Thermal auto-KOT | Browser print / blocked popups | Native print |
| USB / network printer | WebUSB scan or server local dev | Main process `usb` + TCP |
| Print API on Vercel | Returns `printJob` + broadcasts `PRINT_JOB` for a remote desktop to print | Executes job locally (direct or via `PRINT_JOB` broadcast) + `/api/print/ack` |

## App icon

Icons are generated from `client/public/bagicha-logo.svg` into `desktop/icons/`:

```bash
npm run icons   # writes icon.png, icon@2x.png, icon.ico
```

The window title bar / taskbar uses `desktop/icons/icon.png`. Installers use `icon.ico` on Windows via `electron-builder.yml`.

## Distribution build

The desktop app bundles the **Vite-built UI** (`dist/public`) and talks to your **hosted API** on Vercel (not a bundled Express server). Set the API URL **at build time** so login and print work in the installed app.

### 1. Configure production API URL

Create or edit `.env.production.local` (or export vars in the shell before building):

```env
VITE_API_BASE_URL=https://your-app.vercel.app
VITE_PUSHER_KEY=your-pusher-key
VITE_PUSHER_CLUSTER=ap2
VITE_PUSHER_CHANNEL=bagicha-pos
```

On Vercel, add your installer’s origin or `file://` is not applicable — use a custom protocol or ensure `ALLOWED_ORIGINS` includes how users reach the API. For Electron, cookies are sent to `VITE_API_BASE_URL`; that host must be listed in `ALLOWED_ORIGINS`.

### 2. Build the Electron bundle

```bash
npm run build:electron
```

This runs `ELECTRON_BUILD=1 vite build` (relative `./` asset paths for `file://`) and compiles `desktop/dist/main.mjs` + `preload.cjs`.

### 3. Package installers

| Command | Output |
|---------|--------|
| `npm run pack:win` | `release/Bagicha POS Setup x.x.x.exe` (NSIS) |
| `npm run pack:mac` | `release/Bagicha POS-x.x.x.dmg` + `.zip` (must run on macOS — see below, or use the `release-mac` CI job) |
| `npm run pack:linux` | `release/*.AppImage`, `*.deb` |
| `npm run dist:electron` | All platforms supported on the current OS |

Artifacts land in `release/` (gitignored).

**Windows (your machine):**

```powershell
# Set API URL for this build (PowerShell)
$env:VITE_API_BASE_URL="https://your-app.vercel.app"
$env:VITE_PUSHER_KEY="..."
npm run pack:win
```

**First-time note:** `electron-builder` downloads Electron binaries (~150MB). Code signing is optional; unsigned builds show SmartScreen warnings until users trust the app.

### macOS: no Mac needed to build

`npm run pack:mac` only works when run *on* macOS (electron-builder needs the real OS to produce a `.dmg` and to rebuild native modules like `better-sqlite3`/`usb` for macOS). Since the dev machine here is Windows, macOS builds run in CI instead: `.github/workflows/release.yml` has a `release-mac` job on `macos-latest` that builds both Intel (`x64`) and Apple Silicon (`arm64`) in one run and publishes the `.dmg`/`.zip` to the same GitHub Release as the Windows installer — triggered by the same `git tag vX.Y.Z && git push --tags`.

The build is **unsigned** (no Apple Developer ID cert). electron-builder still applies an ad-hoc signature automatically (required for the app to even launch on Apple Silicon), but macOS Gatekeeper will show "*Bagicha POS* can't be opened because it is from an unidentified developer" on first launch. Staff/owner workaround: right-click the app → **Open** → **Open** in the confirmation dialog (only needed once). To remove this prompt entirely, enroll in the Apple Developer Program ($99/year), add a Developer ID Application certificate as a `CSC_LINK`/`CSC_KEY_PASSWORD` secret, and set `notarize` in `electron-builder.yml`.

### Windows: `Cannot create symbolic link` (winCodeSign)

If packaging fails while extracting `winCodeSign` with *A required privilege is not held by the client*, either:

1. **Use the project defaults** (recommended): `electron-builder.yml` sets `signAndEditExecutable: false` so unsigned builds skip that tool. Run `npm run pack:win` again.
2. **Or** enable **Settings → System → For developers → Developer Mode** on Windows, then rebuild (allows symlinks without admin).
3. **Or** run PowerShell **as Administrator** for the pack command.

To embed version/icon into the `.exe` itself (not only the installer shortcut), enable Developer Mode and set `win.signAndEditExecutable: true` in `electron-builder.yml`.

### 4. Ship to restaurants

1. Install from `release/*.exe` (or DMG/AppImage).
2. Users log in against the same Vercel API as the browser admin.
3. Configure printers in Settings; thermal print runs in the Electron main process.

To change the logo later: edit `bagicha-logo.svg`, run `npm run icons`, commit `desktop/icons/*`, rebuild.

## Commands

```bash
# Full stack (API + UI + local WS) — existing
npm run dev

# Vite UI only
npm run dev:client

# Electron + full stack on :5000 (Express API + UI — same as npm run dev)
npm run dev:electron

# Optional: docked DevTools — set ELECTRON_DEVTOOLS=1

# For Vercel API from local UI, set VITE_API_BASE_URL in .env and ALLOWED_ORIGINS on Vercel

# Typecheck
npm run check

# API bundle for Vercel
npm run build:api

# Web static assets
npm run build:web

# Electron UI bundle (relative paths + desktop main/preload)
npm run build:electron

# Windows installer
npm run pack:win
```

## Print IPC

Channel names and payload types live in `shared/electron/ipc.ts` (single source of truth for preload + main + renderer types).

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `print:execute` | renderer → main | Send a `PrintJob` (`escpos-base64`) to the configured network/USB printer |
| `print:test` | renderer → main | Test print by `printerId` (optional `printJob` from API, else built-in test slip) |
| `usb:scan` | renderer → main | List USB devices (VID/PID) via `node-usb` for printer setup |
| `app:version` | renderer → main | Electron app version string |

Preload exposes `window.electronAPI`: `{ isElectron, print, printTest, getVersion }`.

Main process loads printer registry from `GET /api/settings` using session cookies. API origin is `VITE_API_BASE_URL` / `API_BASE_URL`, or in dev the same origin as `VITE_DEV_SERVER_URL` (default `http://localhost:5000`).

## Print flow (Vercel) — phone-to-desktop printer bridge

Any device whose request can't execute the print locally (Vercel, **or** any deployment where the
configured printer is `type: "usb"`) gets a `printJob` in the HTTP response **and** the server persists
a `print_jobs` row + broadcasts a `PRINT_JOB` realtime event (`server/realtime/publisher.ts`, same Pusher
channel already used for `NEW_ORDER`/`KOT_UPDATE`). This is how a phone on the Vercel UI gets its KOT/bill
to print on the thermal printer wired to the desktop Electron host — the desktop is also a Pusher
subscriber and executes the job locally regardless of which device initiated the request.

1. Client (phone or desktop) calls `POST /api/print/kot` or `/api/print/bill`.
2. API builds the ESC/POS buffer. If it can't print directly, it inserts a `print_jobs` row
   (`status: 'pending'`) and calls `publishRealtime({ type: 'PRINT_JOB', jobId, orderId, jobType, printerId, payload })`,
   then returns `{ printJob: { printerId, encoding, data, jobId }, dispatched: true }` in the HTTP response.
3. **Direct path** (the requesting tab *is* the Electron host): `printGateway.ts`'s `handlePrintResponse`
   calls `POST /api/print/jobs/:id/claim` before `window.electronAPI.print(printJob)`, so it can't double-print
   against step 4.
4. **Broadcast path** (any other Electron host subscribed to the channel, e.g. the requesting device was a
   phone): `usePrintJobBridge.ts` (mounted once in `App.tsx`, no-ops outside `window.electronAPI?.isElectron`)
   receives the `PRINT_JOB` realtime message, claims it the same way, and prints.
5. `POST /api/print/jobs/:id/claim` is an atomic `UPDATE print_jobs SET status='claimed' WHERE status='pending'`
   — whichever of steps 3/4 claims first wins; the loser sees `claimed: false` and skips printing. This is the
   only thing preventing a double print when both paths race for the same job. A claim older than 2 minutes
   (`claimedAt` column) is treated as abandoned and becomes reclaimable — protects against a station crashing
   mid-print. `POST /api/print/jobs/:id/release` (called by `desktop/print/printQueue.ts` on permanent failure,
   and by the web print station on a RawBT handoff error) returns a claimed-but-unprintable job to `pending`
   immediately instead of waiting out the 2-minute window.
6. After a successful print, the existing Electron `PrintQueue` (`desktop/print/printQueue.ts`) auto-calls
   `POST /api/print/ack` (now also passing `jobId`) — this both commits the KOT snapshot / bill count
   **and** flips the `print_jobs` row to `'printed'`. Neither `printGateway.ts` nor `usePrintJobBridge.ts`
   ack separately.
7. **Catch-up / durability backstop**: if the desktop host was offline when a job was broadcast,
   `usePrintJobBridge.ts` also polls `GET /api/print/jobs/pending` on mount and whenever the realtime
   connection (re)opens, claiming and printing any backlog exactly once via the same claim mechanism.

Expected latency on the hot path is ~1-2s, dominated by Pusher delivery (~100-500ms) + the claim round-trip
(~100-300ms) — the `pending` poll is a recovery path only, it never runs during a normal print.

Browser/phone clients with no `window.electronAPI` silently ignore the `PRINT_JOB` broadcast and just show a
"Sent to kitchen printer!" toast (`outcome === 'dispatched'` in `printGateway.ts`) instead of a dead-end
browser print dialog.

## Multi-station printing (category routing + quick-POS sections)

The bridge above assumed one printer, one station. For a restaurant with more than one kitchen/counter
(e.g. an outdoor South Indian section printing on a separate Bluetooth HOIN H58 via a tablet instead of
the main indoor Electron host), two additive layers sit on top of it — everything below is a no-op when
unconfigured (empty `categoryPrinterOverrides` / `posSections`), so a single-printer install behaves
identically.

**Category → printer routing.** Admin → Settings → Print Settings → KOT Print → "Category Routing" maps
individual menu categories to a specific printer (`KOTPrintSettings.categoryPrinterOverrides`, categoryId →
printerId; unmapped categories fall back to the default KOT printer). `POST /api/print/kot`
(`server/printRoutes.ts`) resolves each delta item's target printer, groups items by printer, and generates
**one ESC/POS ticket per printer** — all tickets share the same KOT number. `kotPrintCount` /
`lastKotSnapshot` commit **once per tap, at dispatch** (not per-ticket-ack) — this is a correctness fix as
much as a multi-station requirement: with a single ticket, ack-time commit and dispatch-time commit were
equivalent, but multiple tickets acking independently would otherwise double-increment the count. `/api/print/bill`
resolves a per-order bill printer the same way when every item in the order belongs to one `posSections`
section that has a `billPrinterId` set (see below); otherwise it uses the global bill printer.

**Printer ownership (station scoping).** A station (an Electron host, or a browser tab running as a
"print station" — see below) can be scoped to only the printers physically wired to it via
`printStationCore.ts`'s `localStorage`-backed `ownedPrinterIds`. Empty = owns everything (today's
single-station default, unchanged). `GET /api/print/jobs/pending` accepts `?printerId=a,b` to filter
server-side; the client also filters `PRINT_JOB` broadcasts before claiming, so an unconfigured or
misconfigured host never claims a job it can't physically print.

**Web print station (`/print-station`).** For a device with no Windows/Electron host — e.g. an Android
tablet at an outdoor counter — `client/src/pages/PrintStation.tsx` turns a plain browser tab into a
station: it subscribes to the same `useRealtime()`/`PRINT_JOB` channel, claims jobs for its selected
printers, and hands the ESC/POS payload to the **RawBT** Android app (`rawbt:`/`intent://` URI — RawBT
handles the actual Bluetooth/USB-OTG transmission). Because RawBT gives no print-success callback, the
station acks on handoff (not on confirmed paper-out); the page's "Recent jobs" list lets staff manually
retap a job if it silently failed. A Screen Wake Lock keeps the tablet awake while station mode is on, and
the same claim → catch-up-poll pattern as the Electron bridge recovers any jobs broadcast while offline.

**Quick-POS sections (Tables page).** A `posSections` entry (`{id, name, categoryIds, billPrinterId}`,
configured in the same Print Settings → Sections tab) also renders a dedicated card on the Tables page
(next to the INNER/OUTER table groups) that opens `/pos?section=<id>` — a POS view filtered to only that
section's categories, with no table picker, primary "Print Bill" action, and Settle immediately after
(`client/src/pages/POS.tsx`, `isSectionMode`). This is how the South Indian counter is meant to be staffed:
one tap opens the filtered menu, print routes its KOT to the H58 via category routing above, and the bill
routes to the same printer via `billPrinterId` on the section.

## Vercel `vercel.json`

- `build:api` + optional `build:web` — current config still builds the web UI for browser admin.
- For API-only deploys, set `buildCommand` to `npm run build:api` and adjust `outputDirectory` / rewrites as needed.
