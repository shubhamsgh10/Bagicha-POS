/**
 * updater.ts
 *
 * Isolated auto-update service for Bagicha POS.
 *
 * Safety guarantees:
 *   - Never installs while isPosActive is true (set by renderer during billing/payment)
 *   - Downloads happen silently in the background
 *   - autoInstallOnAppQuit=true means a normal app exit triggers a clean update
 *   - Manual install flow is gated by both "downloaded" and "not-active" checks
 *
 * Only active in packaged (production) builds — skipped in dev mode.
 */

import { app, ipcMain, BrowserWindow } from "electron";
import { autoUpdater, type UpdateInfo, type ProgressInfo } from "electron-updater";
import log from "electron-log";
import {
  IPC,
  type UpdateInstallResult,
} from "../shared/electron/ipc.js";

// ── State ─────────────────────────────────────────────────────────────────────

let isPosActive   = false;  // true while renderer reports active order/payment
let updateReady   = false;  // true once update-downloaded event fires

// ── Logging ───────────────────────────────────────────────────────────────────

// electron-log writes to %APPDATA%/Bagicha POS/logs/main.log on Windows
autoUpdater.logger = log;
(log.transports.file as any).level = "info";

// ── Configuration ─────────────────────────────────────────────────────────────

autoUpdater.autoDownload         = true;  // silent background download
autoUpdater.autoInstallOnAppQuit = true;  // install cleanly when user closes app

// ── Renderer bridge ───────────────────────────────────────────────────────────

function sendToRenderer(channel: string, payload?: unknown): void {
  const wins = BrowserWindow.getAllWindows();
  const win  = wins.length > 0 ? wins[0] : null;
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, payload);
  }
}

// ── Update lifecycle events ───────────────────────────────────────────────────

autoUpdater.on("checking-for-update", () => {
  log.info("[updater] checking for update");
  sendToRenderer(IPC.UPDATE_STATUS, { status: "checking" });
});

autoUpdater.on("update-available", (info: UpdateInfo) => {
  log.info("[updater] update available:", info.version);
  sendToRenderer(IPC.UPDATE_STATUS, { status: "available", version: info.version });
});

autoUpdater.on("update-not-available", () => {
  log.info("[updater] up to date");
  sendToRenderer(IPC.UPDATE_STATUS, { status: "current" });
});

autoUpdater.on("download-progress", (p: ProgressInfo) => {
  const percent = Math.round(p.percent);
  log.info(`[updater] download ${percent}% (${Math.round(p.bytesPerSecond / 1024)} KB/s)`);
  sendToRenderer(IPC.UPDATE_PROGRESS, {
    percent,
    bytesPerSecond: Math.round(p.bytesPerSecond),
  });
});

autoUpdater.on("update-downloaded", (info: UpdateInfo) => {
  log.info("[updater] downloaded:", info.version);
  updateReady = true;
  sendToRenderer(IPC.UPDATE_DOWNLOADED, { version: info.version });
});

autoUpdater.on("error", (err: Error) => {
  log.error("[updater] error:", err.message);
  sendToRenderer(IPC.UPDATE_STATUS, { status: "error", error: err.message });
});

// ── IPC handlers (registered regardless of packaged state) ───────────────────

function registerIPC(): void {
  // Renderer tells main whether the POS is in an active billing/payment state
  ipcMain.handle(IPC.SET_POS_ACTIVE, (_e, active: boolean) => {
    isPosActive = active;
    log.info("[updater] POS active:", active);
  });

  // Renderer can manually trigger a check (e.g. from Settings page)
  ipcMain.handle(IPC.UPDATE_CHECK, async (): Promise<{ ok: boolean; error?: string }> => {
    if (!app.isPackaged) return { ok: false, error: "dev-mode" };
    try {
      await autoUpdater.checkForUpdates();
      return { ok: true };
    } catch (err: any) {
      log.error("[updater] manual check error:", err?.message);
      return { ok: false, error: err?.message ?? "Unknown error" };
    }
  });

  // Renderer requests install — blocked if POS is active or not yet downloaded
  ipcMain.handle(IPC.UPDATE_INSTALL, (): UpdateInstallResult => {
    if (!updateReady)   return { ok: false, reason: "not-downloaded" };
    if (isPosActive)    return { ok: false, reason: "pos-active" };

    log.info("[updater] installing update — app will restart");
    // Small delay lets the renderer receive and display the response before restart
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
    return { ok: true };
  });
}

// ── Auto-check schedule ───────────────────────────────────────────────────────

function scheduleChecks(): void {
  // First check: 15 s after launch (lets UI fully render before network activity)
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(err =>
      log.error("[updater] launch check error:", err?.message)
    );
  }, 15_000);

  // Periodic: every 6 hours
  setInterval(() => {
    autoUpdater.checkForUpdates().catch(err =>
      log.error("[updater] periodic check error:", err?.message)
    );
  }, 6 * 60 * 60_000);
}

// ── Public ────────────────────────────────────────────────────────────────────

export function initUpdater(): void {
  // Always register IPC so renderer calls don't throw in dev mode
  registerIPC();

  if (!app.isPackaged) {
    log.info("[updater] auto-update disabled in development");
    return;
  }

  scheduleChecks();
  log.info("[updater] auto-update initialised");
}
