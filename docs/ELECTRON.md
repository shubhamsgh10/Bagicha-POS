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
| Print API on Vercel | Returns `printJob` (base64 ESC/POS) | Executes job + optional `/api/print/ack` |

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
| `npm run pack:mac` | `release/Bagicha POS-x.x.x.dmg` (build on macOS) |
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

## Print flow (Vercel)

1. Client calls `POST /api/print/kot` or `/api/print/bill`.
2. API builds ESC/POS buffer, returns `{ printJob: { printerId, encoding, data } }` (no TCP/USB on Vercel).
3. Electron `window.electronAPI.print(printJob)` sends bytes locally.
4. Client calls `POST /api/print/ack` to commit KOT snapshot / bill count after success (renderer HTTP, not IPC).

Browser clients use `browserPrint: true` when no printer is configured, or when not using Electron.

## Vercel `vercel.json`

- `build:api` + optional `build:web` — current config still builds the web UI for browser admin.
- For API-only deploys, set `buildCommand` to `npm run build:api` and adjust `outputDirectory` / rewrites as needed.
