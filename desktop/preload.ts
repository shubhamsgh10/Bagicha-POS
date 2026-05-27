import { contextBridge, ipcRenderer } from "electron";
import {
  IPC,
  type PrintExecuteResult,
  type PrintJob,
  type PrintTestPayload,
  type UsbScanResult,
  type UpdateStatusPayload,
  type UpdateProgressPayload,
  type UpdateDownloadedPayload,
  type UpdateInstallResult,
} from "../shared/electron/ipc.js";

const electronAPI = {
  isElectron: true as const,

  // ── Printing ────────────────────────────────────────────────────────────────

  print: (job: PrintJob): Promise<PrintExecuteResult> =>
    ipcRenderer.invoke(IPC.PRINT_EXECUTE, job),

  printTest: (payload: PrintTestPayload): Promise<PrintExecuteResult> =>
    ipcRenderer.invoke(IPC.PRINT_TEST, payload),

  scanUsbDevices: (): Promise<UsbScanResult> => ipcRenderer.invoke(IPC.USB_SCAN),

  getVersion: (): Promise<string> => ipcRenderer.invoke(IPC.APP_VERSION),

  // ── Auto-update actions ──────────────────────────────────────────────────────

  /** Tell main process whether POS is in an active billing/payment state. */
  setPosActive: (active: boolean): Promise<void> =>
    ipcRenderer.invoke(IPC.SET_POS_ACTIVE, active),

  /** Manually trigger an update check (e.g. from Settings). */
  checkForUpdates: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.UPDATE_CHECK),

  /** Install downloaded update. Blocked if POS is active. Returns reason if blocked. */
  installUpdate: (): Promise<UpdateInstallResult> =>
    ipcRenderer.invoke(IPC.UPDATE_INSTALL),

  // ── Auto-update notifications (main → renderer) ──────────────────────────────
  // Each returns a cleanup function; call it to remove the listener on unmount.

  onUpdateStatus: (cb: (p: UpdateStatusPayload) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, p: UpdateStatusPayload) => cb(p);
    ipcRenderer.on(IPC.UPDATE_STATUS, handler);
    return () => ipcRenderer.removeListener(IPC.UPDATE_STATUS, handler);
  },

  onUpdateProgress: (cb: (p: UpdateProgressPayload) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, p: UpdateProgressPayload) => cb(p);
    ipcRenderer.on(IPC.UPDATE_PROGRESS, handler);
    return () => ipcRenderer.removeListener(IPC.UPDATE_PROGRESS, handler);
  },

  onUpdateDownloaded: (cb: (p: UpdateDownloadedPayload) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, p: UpdateDownloadedPayload) => cb(p);
    ipcRenderer.on(IPC.UPDATE_DOWNLOADED, handler);
    return () => ipcRenderer.removeListener(IPC.UPDATE_DOWNLOADED, handler);
  },
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);
