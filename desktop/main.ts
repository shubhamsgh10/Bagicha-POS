import { app, BrowserWindow, ipcMain, session } from "electron";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as E from "../shared/print/escpos.js";
import { IPC, type PrintJob, type PrintTestPayload } from "../shared/electron/ipc.js";
import type { PrinterConfig } from "./types.js";
import { executePrintJob } from "./print/executor.js";
import { listUsbDevices } from "./print/usbScan.js";
import { initUpdater } from "./updater.js";

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

/** Where to load printer settings (session cookies must match this origin). */
function resolveApiBase(): string {
  if (isDev) return new URL(DEV_URL).origin;
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

async function fetchPrinters(): Promise<PrinterConfig[]> {
  const base = resolveApiBase();
  const cookies = await session.defaultSession.cookies.get({ url: base });
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const res = await fetch(`${base}/api/settings`, {
    headers: cookieHeader ? { Cookie: cookieHeader } : {},
  });
  if (!res.ok) throw new Error(`Failed to load printer settings: ${res.status}`);
  const settings = (await res.json()) as { printSettings?: { printers?: PrinterConfig[] } };
  return settings.printSettings?.printers ?? [];
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
    E.centered(printer.name, W),
    E.centered(new Date().toLocaleString("en-IN"), W),
    E.divider("=", W),
    E.centered("Printer is working correctly!", W),
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

function createWindow() {
  const openDevTools = process.env.ELECTRON_DEVTOOLS === "1";

  console.log("[electron] Creating window…", isDev ? DEV_URL : "production build");

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

  mainWindow.once("ready-to-show", revealWindow);
  mainWindow.webContents.once("did-finish-load", revealWindow);
  setTimeout(revealWindow, 1500);

  mainWindow.webContents.on("did-fail-load", (_event, code, desc, url) => {
    console.error("[electron] Failed to load:", url, code, desc);
    revealWindow();
  });

  if (isDev) {
    mainWindow
      .loadURL(DEV_URL)
      .then(() => {
        console.log("[electron] Loaded", DEV_URL);
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

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) revealWindow();
    else createWindow();
  });

  app.whenReady().then(() => {
    if (process.platform === "win32") {
      app.setAppUserModelId("com.bagicha.pos");
    }
    console.log("[electron] App ready");
    createWindow();
    initUpdater();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else revealWindow();
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle(IPC.APP_VERSION, () => app.getVersion());

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
  try {
    const printers = await fetchPrinters();
    await executePrintJob(job, printers);
    return { ok: true };
  } catch (err: any) {
    console.error("[electron/print]", err);
    return { ok: false, error: err?.message ?? String(err) };
  }
});

ipcMain.handle(IPC.PRINT_TEST, async (_event, payload: PrintTestPayload) => {
  try {
    const printers = await fetchPrinters();
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
