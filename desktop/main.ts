import { app, BrowserWindow, ipcMain, session, dialog, shell } from "electron";
import { spawn, type ChildProcess } from "child_process";
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import * as E from "../shared/print/escpos.js";
import { formatISTDateTime } from "../shared/print/formatDate.js";
import { IPC, type PrintJob, type PrintTestPayload, type AttendanceDeviceConfig, type PrintStationConfig, type LocalModeStatus, type LocalModeEnableResult } from "../shared/electron/ipc.js";
import { buildLocalChildEnv, newLocalNonce, parseLocalHostSettings, resolveEnableConfig, type LocalHostSettings } from "./localMode.js";
import { LocalServer } from "./localServer.js";
import type { PrinterConfig } from "./types.js";
import { executePrintJob } from "./print/executor.js";
import { listUsbDevices } from "./print/usbScan.js";
import { initUpdater } from "./updater.js";
import { warmPrinterSession, closePrinterSession } from "../shared/print/persistentPs.js";
import { windowsPrinterQueueExists } from "../shared/print/windowsPrinters.js";
import { PrintQueue } from "./print/printQueue.js";
import { PrintLog } from "./print/printLog.js";
import { AttendanceAgent } from "./attendance/attendanceAgent.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ICON_PATH = path.join(__dirname, "../icons/icon.png");

/** Vite output: repo dist/public; main bundle lives in desktop/dist. */
function resolveIndexHtml(): string {
  const candidates = [
    path.join(__dirname, "../../dist/public/index.html"),
    path.join(app.getAppPath(), "dist/public/index.html"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(
    `UI bundle not found. Run npm run build:electron first. Tried:\n${candidates.join("\n")}`,
  );
}

/** Packaged apps must not load localhost — NODE_ENV is often unset in installed Electron. */
const isDev = !app.isPackaged;
const DEV_URL = (process.env.VITE_DEV_SERVER_URL || "http://localhost:5000").replace(
  "127.0.0.1",
  "localhost",
);
const API_BASE_ENV = process.env.VITE_API_BASE_URL || process.env.API_BASE_URL || "";

let mainWindow: BrowserWindow | null = null;

// ── Embedded backend (host build) ─────────────────────────────────────────────
// A dedicated host build (BAGICHA_EMBEDDED=1, injected at package time) spawns the
// bundled Express server + Baileys locally, so this desktop becomes the always-on
// WhatsApp host. The window then loads from http://localhost:<port> so the
// renderer + WebSocket target the local server. Normal builds are unchanged.
// Baileys is a singleton — only ONE machine may run a host build.
const IS_EMBEDDED = process.env.BAGICHA_EMBEDDED === "1";
const EMBEDDED_PORT = process.env.BAGICHA_PORT || "5179";
const EMBEDDED_URL = `http://localhost:${EMBEDDED_PORT}`;
// Local mode loads the exact address the readiness probe and the child's bind use.
const LOCAL_URL = `http://127.0.0.1:${EMBEDDED_PORT}`;

let serverProc: ChildProcess | null = null;
let serverStopping = false;
let serverRestarts = 0;
let embeddedReady = false;

// -- Local mode (thin client + its own server and local copy of the data) ------
// host-config.json { localMode, cloudUrl, deviceToken } makes THIS PC run the bundled server in
// local mode (server/local/*, reads from PGlite, writes forwarded to the cloud) and load the window
// from it. The host (embedded) build ignores it. If the local server cannot start or keeps crashing
// the window falls back to the normal cloud client for that run - the shop is never stuck.
let localServer: LocalServer | null = null;
let localActive = false;
let localPending = false;
let localReason: string | undefined;
/** Per-launch secret shared with the local server child (BAGICHA_LOCAL_NONCE); never logged. */
let localNonce = "";

function hostConfigPath(): string {
  return path.join(app.getPath("userData"), "host-config.json");
}

function readHostConfigFile(): Record<string, unknown> {
  try {
    const p = hostConfigPath();
    if (fs.existsSync(p)) {
      const parsed = JSON.parse(fs.readFileSync(p, "utf-8"));
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    }
  } catch (e) {
    console.warn("[electron] host-config.json read failed:", e);
  }
  return {};
}

/** Merges `patch` into host-config.json (other fields untouched); atomic, owner-only where the OS allows. */
function writeHostConfigFile(patch: Record<string, unknown>): void {
  const next = { ...readHostConfigFile(), ...patch };
  const p = hostConfigPath();
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { encoding: "utf-8", mode: 0o600 });
  fs.renameSync(tmp, p);
}

/** Random secret for the local server's session cookies, created once and kept in userData (never logged). */
function localSessionSecret(): string {
  const p = path.join(app.getPath("userData"), "local-session-secret");
  try {
    const existing = fs.readFileSync(p, "utf-8").trim();
    if (existing.length >= 32) return existing;
  } catch { /* create below */ }
  const secret = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(p, secret, { encoding: "utf-8", mode: 0o600 });
  return secret;
}

/** Local mode applies to the thin-client build only (not the host build); dev needs BAGICHA_LOCAL_DEV=1. */
function localModeAllowed(): boolean {
  return !IS_EMBEDDED && (!isDev || process.env.BAGICHA_LOCAL_DEV === "1");
}

function localSettings(): { settings: LocalHostSettings | null; problem?: string } {
  const r = parseLocalHostSettings(readHostConfigFile(), API_BASE_ENV);
  return { settings: r.enabled ? r.settings : null, problem: r.problem };
}

function dropLocalMode(reason: string): void {
  console.warn(`[electron] local mode off for this run: ${reason}`);
  localActive = false;
  localReason = reason;
  printerCache = null; // the cloud session is a different cookie jar
  try { localServer?.stop(); } catch { /* ignore */ }
  localServer = null;
}

/** Starts the local server child; true when the window should load it. Never throws. */
async function startLocalMode(settings: LocalHostSettings): Promise<boolean> {
  try {
    const entry = path.join(app.getAppPath(), "dist", "index.js");
    if (!fs.existsSync(entry)) {
      dropLocalMode("this build has no server bundle (dist/index.js)");
      return false;
    }
    const userData = app.getPath("userData");
    localNonce = newLocalNonce();
    const env = buildLocalChildEnv(process.env, {
      cloudUrl: settings.cloudUrl,
      deviceToken: settings.deviceToken,
      pgliteDir: path.join(userData, "localdb"),
      dataDir: userData,
      port: EMBEDDED_PORT,
      sessionSecret: localSessionSecret(),
      nonce: localNonce,
    });
    localServer = new LocalServer({ execPath: process.execPath, entry, env, port: Number(EMBEDDED_PORT), nonce: localNonce });
    localServer.onGaveUp = (reason) => {
      dropLocalMode(reason);
      loadThinClient();
    };
    localServer.onReadyLater = () => {
      localReason = "the local server finished starting after the time limit - restart the app to use it";
      console.log(`[electron] ${localReason}`);
    };
    console.log(`[electron] starting local server on ${LOCAL_URL}...`);
    const res = await localServer.start();
    if (!res.ok) {
      // A server still warming up (first snapshot) is left running in the background; anything else is stopped.
      if (/not ready within/.test(res.reason)) { localActive = false; localReason = res.reason; }
      else dropLocalMode(res.reason);
      return false;
    }
    localActive = true;
    localReason = undefined;
    console.log("[electron] local server ready");
    return true;
  } catch (e: any) {
    dropLocalMode(e?.message ?? String(e));
    return false;
  }
}

/** The normal cloud client (file:// + baked API URL), or the dev server in dev. */
function loadThinClient(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (isDev) {
    void mainWindow.loadURL(DEV_URL).catch((e) => console.error("[electron] loadURL failed:", e));
    return;
  }
  try {
    void mainWindow.loadFile(resolveIndexHtml());
  } catch (e) {
    console.error("[electron] loadFile failed:", e);
  }
}

function isTrustedSender(e: Electron.IpcMainInvokeEvent): boolean {
  const url = e.senderFrame?.url ?? "";
  if (url.startsWith("file://")) return true;
  try {
    const origin = new URL(url).origin;
    if ((localActive || localPending) && origin === new URL(LOCAL_URL).origin) return true;
    return origin === new URL(EMBEDDED_URL).origin || (isDev && origin === new URL(DEV_URL).origin);
  } catch {
    return false;
  }
}

function relaunchSoon(): void {
  // Let the IPC reply reach the renderer, stop the child (app.exit skips will-quit), then restart.
  setTimeout(() => {
    try { localServer?.stop(); } catch { /* ignore */ }
    app.relaunch();
    app.exit(0);
  }, 300);
}

/** DB creds: userData/host-config.json (admin-editable) overrides build-injected values. */
function resolveHostConfig(): { DATABASE_URL?: string; SESSION_SECRET?: string } {
  const fromBuild = {
    DATABASE_URL: process.env.DATABASE_URL || undefined,
    SESSION_SECRET: process.env.SESSION_SECRET || undefined,
  };
  try {
    const p = path.join(app.getPath("userData"), "host-config.json");
    if (fs.existsSync(p)) {
      const file = JSON.parse(fs.readFileSync(p, "utf-8"));
      return { ...fromBuild, ...file };
    }
  } catch (e) {
    console.warn("[electron] host-config.json read failed:", e);
  }
  return fromBuild;
}

/**
 * Which printers THIS device's Print Station should claim jobs for — durable, file-backed
 * (userData/print-station-config.json), not browser localStorage.
 *
 * Why: localStorage is what client/src/lib/printStationCore.ts used exclusively before this
 * — and on a thin-client Electron install (renderer loaded via `loadFile`, i.e. a `file://`
 * origin — see the isDev/IS_EMBEDDED branch in createWindow below) this codebase has already
 * hit one prior class of file://-origin storage bug (see git history: "Fix file:// origin
 * logout/asset paths and stale per-instance settings cache"). A user reported the printer
 * checklist here silently re-checking a printer they'd explicitly unchecked, days after
 * unchecking it — every write to that setting is user-click-driven (no code auto-re-adds an
 * id), so the only explanation is the browser-storage write not durably surviving. A plain
 * JSON file write is categorically more durable (synchronous fs write, inspectable, immune to
 * origin-partitioning/eviction quirks) — the renderer now treats this file as authoritative
 * and resyncs its localStorage cache to match on every load (see printStationCore.ts).
 */
function printStationConfigPath(): string {
  return path.join(app.getPath("userData"), "print-station-config.json");
}

function readPrintStationConfig(): PrintStationConfig | null {
  try {
    const p = printStationConfigPath();
    if (!fs.existsSync(p)) return null;
    const file = JSON.parse(fs.readFileSync(p, "utf-8"));
    return {
      enabled: !!file.enabled,
      ownedPrinterIds: Array.isArray(file.ownedPrinterIds)
        ? file.ownedPrinterIds.filter((x: unknown): x is string => typeof x === "string")
        : [],
    };
  } catch (e) {
    console.warn("[electron] print-station-config.json read failed:", e);
    return null;
  }
}

function writePrintStationConfig(cfg: PrintStationConfig): boolean {
  try {
    fs.writeFileSync(printStationConfigPath(), JSON.stringify(cfg, null, 2), "utf-8");
    return true;
  } catch (e) {
    console.warn("[electron] print-station-config.json write failed:", e);
    return false;
  }
}

function waitForServer(maxMs = 120_000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(
        { hostname: "localhost", port: Number(EMBEDDED_PORT), path: "/api/auth/context", timeout: 3000 },
        (res) => { res.resume(); resolve(); },
      );
      req.on("error", () => {
        if (Date.now() - start > maxMs) reject(new Error("Embedded server did not start in time"));
        else setTimeout(attempt, 500);
      });
      req.on("timeout", () => {
        req.destroy();
        if (Date.now() - start > maxMs) reject(new Error("Embedded server timed out"));
        else setTimeout(attempt, 500);
      });
    };
    attempt();
  });
}

function spawnServer(cfg: { DATABASE_URL?: string; SESSION_SECRET?: string }): void {
  // Run the bundled server with Electron's own Node (ELECTRON_RUN_AS_NODE).
  const serverEntry = path.join(app.getAppPath(), "dist", "index.js");
  serverProc = spawn(process.execPath, [serverEntry], {
    stdio: "inherit",
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      PORT: EMBEDDED_PORT,
      BAGICHA_DATA_DIR: app.getPath("userData"),
      // The host build exists to be the always-on WhatsApp host, so it runs the
      // background jobs (off by default elsewhere — server/backgroundJobs.ts).
      BACKGROUND_JOBS: process.env.BACKGROUND_JOBS || "on",
      ...(cfg.DATABASE_URL ? { DATABASE_URL: cfg.DATABASE_URL } : {}),
      ...(cfg.SESSION_SECRET ? { SESSION_SECRET: cfg.SESSION_SECRET } : {}),
    },
  });
  const startedAt = Date.now();
  serverProc.on("exit", (code) => {
    console.warn(`[electron] embedded server exited (${code})`);
    serverProc = null;
    if (serverStopping) return;
    // The budget is for crash LOOPS, not the app's lifetime: a server that ran for 5+ min
    // before exiting starts a fresh budget (an always-on host used to give up for good after
    // its 5th crash in weeks). Restarts back off 1 s, 2 s, 4 s … up to 30 s.
    if (Date.now() - startedAt > 5 * 60_000) serverRestarts = 0;
    if (serverRestarts >= 5) {
      console.error("[electron] embedded server keeps crashing — not restarting again");
      return;
    }
    const delay = Math.min(30_000, 1000 * 2 ** serverRestarts);
    serverRestarts++;
    console.log(`[electron] restarting embedded server (#${serverRestarts}) in ${delay} ms…`);
    setTimeout(() => { if (!serverStopping && !serverProc) spawnServer(cfg); }, delay);
  });
  serverProc.on("error", (err) => console.error("[electron] embedded server spawn error:", err));
}

async function startEmbeddedServer(): Promise<boolean> {
  const cfg = resolveHostConfig();
  if (!cfg.DATABASE_URL) {
    dialog.showErrorBox(
      "Database not configured",
      "This host build has no DATABASE_URL. Set it at package time, or create a host-config.json " +
        `({ "DATABASE_URL": "…" }) in:\n${app.getPath("userData")}`,
    );
    return false;
  }
  console.log(`[electron] starting embedded server on ${EMBEDDED_URL}…`);
  spawnServer(cfg);
  try {
    await waitForServer();
    console.log("[electron] embedded server ready");
    return true;
  } catch (e: any) {
    dialog.showErrorBox("Server failed to start", e?.message ?? String(e));
    return false;
  }
}

function stopEmbeddedServer(): void {
  serverStopping = true;
  if (serverProc && !serverProc.killed) {
    try { serverProc.kill(); } catch { /* ignore */ }
  }
  serverProc = null;
}

/** Where to load printer settings (session cookies must match this origin). */
function resolveApiBase(): string {
  if (localActive) return LOCAL_URL; // the local server holds the session cookie
  if (isDev) return new URL(DEV_URL).origin;
  if (IS_EMBEDDED) return EMBEDDED_URL;
  if (API_BASE_ENV) return API_BASE_ENV.replace(/\/$/, "");
  const loaded = mainWindow?.webContents.getURL();
  if (loaded?.startsWith("http")) return new URL(loaded).origin;
  throw new Error(
    "Set VITE_API_BASE_URL or API_BASE_URL for Electron (e.g. https://your-app.vercel.app)",
  );
}

function isValidPrintJob(job: unknown): job is PrintJob {
  if (!job || typeof job !== "object") return false;
  const j = job as PrintJob;
  return (
    typeof j.printerId === "string" &&
    j.encoding === "escpos-base64" &&
    typeof j.data === "string" &&
    j.data.length > 0
  );
}

// Returns null when the user isn't logged in yet (401) — caller must not cache this.
async function fetchPrinters(): Promise<PrinterConfig[] | null> {
  const base = resolveApiBase();
  const cookies = await session.defaultSession.cookies.get({ url: base });
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const res = await fetch(`${base}/api/settings`, {
    headers: cookieHeader ? { Cookie: cookieHeader } : {},
  });
  if (res.status === 401) return null; // not logged in yet — skip silently
  if (!res.ok) throw new Error(`Failed to load printer settings: ${res.status}`);
  const settings = (await res.json()) as { printSettings?: { printers?: PrinterConfig[] } };
  return settings.printSettings?.printers ?? [];
}

/** Reusable cookie header for authenticated API calls (matches the POS session). */
async function getCookieHeader(): Promise<string> {
  const base = resolveApiBase();
  const cookies = await session.defaultSession.cookies.get({ url: base });
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

/** Read biometric-device config from /api/settings (null until a POS user is logged in). */
async function fetchAttendanceConfig(): Promise<AttendanceDeviceConfig | null> {
  const base = resolveApiBase();
  const cookieHeader = await getCookieHeader();
  const res = await fetch(`${base}/api/settings`, {
    headers: cookieHeader ? { Cookie: cookieHeader } : {},
  });
  if (res.status === 401 || !res.ok) return null; // not logged in yet — agent retries later
  const settings = (await res.json()) as { attendanceDevice?: AttendanceDeviceConfig };
  return settings.attendanceDevice ?? null;
}

let printerCache: PrinterConfig[] | null = null;
let printQueue: PrintQueue | null = null;
let printLog: PrintLog | null = null;
let attendanceAgent: AttendanceAgent | null = null;

// 60 s cache: printer edits made from ANY other device (a phone, the web app) used to never reach
// this queue — the cache was only cleared by this window's own Print Settings panel.
let printerCacheAt = 0;
const PRINTER_CACHE_MS = 60_000;
async function getPrinters(): Promise<PrinterConfig[]> {
  if (printerCache !== null && Date.now() - printerCacheAt < PRINTER_CACHE_MS) return printerCache;
  const result = await fetchPrinters();
  if (result === null) return printerCache ?? []; // unauthenticated / offline — keep the last known list
  printerCache = result;
  printerCacheAt = Date.now();
  return printerCache;
}

function buildTestBuffer(printer: PrinterConfig): Buffer {
  const W = printer.width ?? 32;
  return E.build(
    E.INIT,
    E.ALIGN_CENTER,
    E.BOLD_ON,
    E.line("TEST PRINT"),
    E.BOLD_OFF,
    E.divider("-", W),
    // Plain lines under the printer's own ALIGN_CENTER (E.centered double-centres), and IST time.
    E.line(printer.name),
    E.line((({ dateStr, timeStr }) => `${dateStr} ${timeStr}`)(formatISTDateTime(new Date()))),
    E.divider("=", W),
    E.line("Printer is working correctly!"),
    E.feed(3),
    E.CUT,
  );
}

function revealWindow() {
  if (!mainWindow) return;
  if (!mainWindow.isVisible()) mainWindow.show();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

async function createWindow() {
  const openDevTools = process.env.ELECTRON_DEVTOOLS === "1";

  console.log("[electron] Creating window…", isDev ? DEV_URL : "production build");

  if (isDev) {
    // Electron's default session persists its HTTP cache to disk in userData,
    // independent of the Node process lifecycle — restarting `npm run
    // dev:electron` (even killing it fully) does NOT clear it, only Vite's own
    // server-side node_modules/.vite cache does. A stale disk-cached JS module
    // response here can silently outlive many "full restarts", which is exactly
    // what made an earlier bug look unfixable across several attempted fixes.
    // A plain browser (e.g. Playwright/Chrome) never showed the same problem
    // because it wasn't sharing this persistent, disk-backed cache at all.
    try {
      await session.defaultSession.clearCache();
      console.log("[electron] Cleared session HTTP cache (dev mode)");
    } catch (e) {
      console.warn("[electron] Failed to clear session cache:", e);
    }
  }

  const windowIcon = ICON_PATH;
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: true,
    center: true,
    title: "Bagicha POS",
    icon: windowIcon,
    autoHideMenuBar: true,
    backgroundColor: "#f8fafc",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // External links (wa.me, payment pages…) open in the system browser, never as an Electron window:
  // a child window inherits this window's preload, so a third-party page got window.electronAPI
  // (raw printing, print-station config, USB scan). about:blank stays in-app — the browser-print
  // fallback writes its ticket into one.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url === "about:blank" || url.startsWith("blob:")) return { action: "allow" };
    if (/^https?:\/\//i.test(url) || url.startsWith("whatsapp:") || url.startsWith("mailto:")) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const current = mainWindow?.webContents.getURL() ?? "";
    let sameApp = url.startsWith("file://");
    try { if (!sameApp && current) sameApp = new URL(url).origin === new URL(current).origin; } catch { sameApp = false; }
    if (!sameApp) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    }
  });

  mainWindow.once("ready-to-show", revealWindow);
  mainWindow.webContents.once("did-finish-load", revealWindow);
  setTimeout(revealWindow, 1500);

  mainWindow.webContents.on("did-fail-load", (_event, code, desc, url) => {
    console.error("[electron] Failed to load:", url, code, desc);
    revealWindow();
  });

  const remoteUrl = localActive ? LOCAL_URL : isDev ? DEV_URL : IS_EMBEDDED && embeddedReady ? EMBEDDED_URL : null;
  if (localPending) {
    // Local server still starting (first start may download a snapshot): show a plain page, not a blank window.
    const splash =
      "<body style='margin:0;display:flex;align-items:center;justify-content:center;height:100vh;" +
      "font-family:system-ui,sans-serif;background:#f8fafc;color:#334155'><div style='text-align:center'>" +
      "<div style='font-size:22px;font-weight:600'>Bagicha POS</div>" +
      "<div style='margin-top:8px;font-size:14px'>Starting this PC's local server...</div></div></body>";
    void mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(splash)}`);
  } else if (remoteUrl) {
    mainWindow
      .loadURL(remoteUrl)
      .then(() => {
        console.log("[electron] Loaded", remoteUrl);
        if (openDevTools) mainWindow?.webContents.openDevTools({ mode: "right" });
      })
      .catch((err) => {
        console.error("[electron] loadURL failed:", err);
        revealWindow();
      });
  } else {
    const indexHtml = resolveIndexHtml();
    console.log("[electron] Loading UI:", indexHtml);
    mainWindow.loadFile(indexHtml);
  }
}

async function runStartupHealthCheck(): Promise<void> {
  try {
    const printers = await getPrinters();
    for (const p of printers) {
      if (p.type !== "usb" || !p.windowsQueueName) continue;
      const exists = await windowsPrinterQueueExists(p.windowsQueueName).catch(() => false);
      if (!exists) {
        console.warn(`[electron] Printer "${p.name}" queue not found: ${p.windowsQueueName}`);
        mainWindow?.webContents.send(IPC.PRINTER_HEALTH, {
          printerId: p.id,
          printerName: p.name,
          online: false,
          message: `Printer "${p.name}" not detected. Check USB connection and ensure printer is powered on.`,
        });
      }
    }
  } catch (e) {
    console.warn("[electron] startup health check failed:", e);
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) revealWindow();
    else createWindow();
  });

  app.whenReady().then(async () => {
    if (process.platform === "win32") {
      app.setAppUserModelId("com.bagicha.pos");
    }
    console.log("[electron] App ready");
    if (IS_EMBEDDED) {
      embeddedReady = await startEmbeddedServer();
    }
    const local = localModeAllowed() ? localSettings() : { settings: null as LocalHostSettings | null, problem: undefined as string | undefined };
    if (local.problem) { localReason = local.problem; console.warn(`[electron] ${local.problem}`); }
    localPending = !!local.settings;
    createWindow();
    initUpdater();
    // Pre-warm printer cache and PowerShell session (non-blocking)
    if (local.settings) {
      void startLocalMode(local.settings).then((ok) => {
        localPending = false;
        if (ok) void mainWindow?.loadURL(LOCAL_URL).catch((e) => console.error("[electron] loadURL failed:", e));
        else loadThinClient();
        getPrinters().catch((e) => console.warn("[electron] printer cache warm:", e));
      });
    } else {
      getPrinters().catch((e) => console.warn("[electron] printer cache warm:", e));
    }
    warmPrinterSession().catch((e) => console.warn("[electron] printer session warm:", e));
    // Initialize print log and queue (loads persisted jobs from disk)
    printLog = new PrintLog(app.getPath("userData"));
    printQueue = new PrintQueue(
      app.getPath("userData"),
      getPrinters,
      async () => {
        const base = resolveApiBase();
        const cookies = await session.defaultSession.cookies.get({ url: base });
        return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
      },
      resolveApiBase,
      printLog,
    );
    // Biometric attendance agent (K30 Pro) — LAN-local sibling of the print queue.
    attendanceAgent = new AttendanceAgent(
      app.getPath("userData"),
      fetchAttendanceConfig,
      getCookieHeader,
      resolveApiBase,
    );
    attendanceAgent.start().catch((e) => console.warn("[attendance] start failed:", e));
    // Startup health check — runs after window is ready to receive IPC events
    mainWindow?.webContents.once("did-finish-load", () => {
      runStartupHealthCheck();
    });
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else revealWindow();
  });
}

app.on("will-quit", () => {
  stopEmbeddedServer();
  try { localServer?.stop(); } catch { /* ignore */ }
  closePrinterSession();
  void attendanceAgent?.stop();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle(IPC.APP_VERSION, () => app.getVersion());

// -- Local mode ----------------------------------------------------------------

ipcMain.handle(IPC.LOCAL_STATUS, (): LocalModeStatus => {
  const configured = localModeAllowed() && !!localSettings().settings;
  return { active: localActive, configured, ...(localReason ? { reason: localReason } : {}) };
});

ipcMain.handle(IPC.LOCAL_ENABLE, (e, input: unknown): LocalModeEnableResult => {
  if (!isTrustedSender(e)) return { ok: false, error: "Not allowed from this page" };
  if (!localModeAllowed()) return { ok: false, error: "Local mode is available in the installed shop PC app only" };
  // The renderer sends only { deviceToken }; the cloud URL comes from host-config.json (hand-edited) or the baked API base.
  const v = resolveEnableConfig(input, readHostConfigFile(), API_BASE_ENV);
  if (!v.ok) return { ok: false, error: v.error };
  try {
    // cloudUrl is deliberately not written: it is re-resolved at every start (parseLocalHostSettings).
    writeHostConfigFile({ localMode: true, deviceToken: v.deviceToken });
  } catch (err: any) {
    return { ok: false, error: `Could not save the setting: ${err?.message ?? err}` };
  }
  console.log("[electron] local mode enabled - restarting");
  relaunchSoon();
  return { ok: true };
});

ipcMain.handle(IPC.LOCAL_DISABLE, (e): LocalModeEnableResult => {
  if (!isTrustedSender(e)) return { ok: false, error: "Not allowed from this page" };
  try {
    writeHostConfigFile({ localMode: false, deviceToken: "" });
  } catch (err: any) {
    return { ok: false, error: `Could not save the setting: ${err?.message ?? err}` };
  }
  console.log("[electron] local mode disabled - restarting");
  relaunchSoon();
  return { ok: true };
});

// Stall breaker (packages/api-client/stallBreaker.ts): the renderer found its API connection dead
// (no answer, and a check request on the same connection silent too). Closing the session's
// connections fails the stuck HTTP/2 request at once so it can be retried on a fresh connection.
// Measured on Electron 33: open WebSockets — Pusher, which carries PRINT_JOB — are NOT closed by this.
ipcMain.handle(IPC.NET_RESET_CONNECTIONS, async (e) => {
  await e.sender.session.closeAllConnections();
});

ipcMain.handle(IPC.USB_SCAN, async () => {
  try {
    const devices = await listUsbDevices();
    return { ok: true, devices };
  } catch (err: any) {
    console.error("[electron/usb:scan]", err);
    return { ok: false, error: err?.message ?? String(err) };
  }
});

ipcMain.handle(IPC.PRINT_EXECUTE, async (_event, job: unknown) => {
  if (!isValidPrintJob(job)) {
    return { ok: false, error: "Invalid print job payload" };
  }
  const j = job as PrintJob;
  const jobId = printQueue!.enqueue({
    printJob: j,
    type: (j.ackType as "kot" | "bill") ?? "kot",
    orderId: j.orderId,
    ackType: j.ackType,
  });
  return { ok: true, jobId };
});

ipcMain.handle(IPC.PRINT_TEST, async (_event, payload: PrintTestPayload) => {
  try {
    const printers = await getPrinters();
    const printer = printers.find((p) => p.id === payload.printerId);
    if (!printer) {
      return { ok: false, error: `Printer "${payload.printerId}" not found in settings` };
    }
    if (payload.printJob) {
      if (!isValidPrintJob(payload.printJob)) {
        return { ok: false, error: "Invalid print job payload" };
      }
      await executePrintJob(payload.printJob, printers);
    } else {
      const buffer = buildTestBuffer(printer);
      const job: PrintJob = {
        printerId: printer.id,
        encoding: "escpos-base64",
        data: buffer.toString("base64"),
      };
      await executePrintJob(job, printers);
    }
    return { ok: true };
  } catch (err: any) {
    console.error("[electron/print:test]", err);
    return { ok: false, error: err?.message ?? String(err) };
  }
});

ipcMain.handle(IPC.QUEUE_STATUS, () => printQueue?.getStatus() ?? []);

ipcMain.handle(IPC.PRINT_LOGS, (_e, n?: number) => printLog?.getRecent(n) ?? []);

/**
 * Live, this-machine check for whether a Windows print queue by this exact name is
 * REGISTERED right now — used by the renderer BEFORE claiming a broadcast print job, so a
 * second Electron host (e.g. left open on a laptop with no printer wired up, and no queue
 * by this name installed there at all) doesn't win the claim race purely because the shared
 * DB config's `windowsQueueName` string looks valid on paper.
 *
 * This only proves the queue NAME exists on this machine — Get-Printer can't tell a real,
 * connected printer apart from an orphaned/ghost queue with no hardware behind it. If the
 * wrong machine happens to have a genuinely-registered queue under the identical name (e.g.
 * the same printer model was set up there too, at some point), this check still passes there
 * and can't disambiguate — only per-device `ownedPrinterIds` scoping fully closes that case.
 */
ipcMain.handle(IPC.PRINTER_QUEUE_EXISTS, async (_e, queueName: unknown) => {
  if (typeof queueName !== "string" || !queueName.trim()) return false;
  return windowsPrinterQueueExists(queueName).catch(() => false);
});

ipcMain.handle(IPC.PRINT_STATION_CONFIG_GET, (): PrintStationConfig | null => readPrintStationConfig());

ipcMain.handle(IPC.PRINT_STATION_CONFIG_SET, (_e, cfg: unknown): boolean => {
  if (!cfg || typeof cfg !== "object") return false;
  const c = cfg as Partial<PrintStationConfig>;
  return writePrintStationConfig({
    enabled: !!c.enabled,
    ownedPrinterIds: Array.isArray(c.ownedPrinterIds)
      ? c.ownedPrinterIds.filter((x): x is string => typeof x === "string")
      : [],
  });
});

ipcMain.handle(IPC.REFRESH_PRINTERS, async () => {
  printerCache = null;
  try {
    const result = await fetchPrinters();
    if (result === null) return { ok: false, error: "Not logged in" };
    printerCache = result;
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
});

// ── Biometric attendance device (K30 Pro) ────────────────────────────────────

ipcMain.handle(IPC.ATTENDANCE_TEST, async (_event, cfg: AttendanceDeviceConfig) => {
  if (!attendanceAgent) return { ok: false, error: "Agent not ready" };
  return attendanceAgent.testConnection(cfg);
});

ipcMain.handle(IPC.ATTENDANCE_STATUS, () =>
  attendanceAgent?.getStatus() ?? { enabled: false, connected: false, lastSyncAt: null, buffered: 0 },
);

ipcMain.handle(IPC.ATTENDANCE_REFRESH, async () => {
  if (!attendanceAgent) return { ok: false };
  await attendanceAgent.restart().catch((e) => console.warn("[attendance] refresh failed:", e));
  return { ok: true };
});
