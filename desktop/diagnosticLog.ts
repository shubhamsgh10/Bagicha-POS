// Desktop diagnostic log: everything needed to explain a "Something went wrong" on the shop PC, in one
// file that survives no internet — %APPDATA%\Bagicha POS\logs\main.log (electron-log, same file the
// updater already writes). Before this, the packaged app logged only updater lines, DevTools was off
// and the 17 Nov 2026 crash left no trace of what threw.
//
// What lands there:
//   - every renderer crash / uncaught error report (IPC from client/src/lib/errorReporter.ts),
//   - console.error lines from the page (throttled),
//   - the renderer process dying or hanging (render-process-gone / unresponsive),
//   - main-process uncaught exceptions / rejections.
import { ipcMain, type WebContents } from "electron";
import log from "electron-log";
import { IPC } from "../shared/electron/ipc.js";
import { sanitizeClientErrorReport, clientErrorLogLine } from "../shared/clientErrorReport.js";

let installed = false;

/** Call once at startup (before the window opens). */
export function initDiagnosticLog(): void {
  if (installed) return;
  installed = true;
  (log.transports.file as any).level = "info";
  (log.transports.file as any).maxSize = 5 * 1024 * 1024; // rotates to main.old.log
  log.errorHandler.startCatching({ showDialog: false });

  ipcMain.handle(IPC.LOG_RENDERER_ERROR, (_e, body: unknown) => {
    const r = sanitizeClientErrorReport(body);
    if (!r) return;
    log.error(clientErrorLogLine(r));
    // Full detail on following lines: stack, component, the last requests and query errors.
    if (r.stack) log.error(`[client-error] ${r.errorId} stack:\n${r.stack}`);
    if (r.componentStack) log.error(`[client-error] ${r.errorId} component:${r.componentStack.slice(0, 1200)}`);
    if (r.requests.length) {
      log.error(`[client-error] ${r.errorId} requests: ` +
        r.requests.map((q) => `${q.m} ${q.p} ${q.s ?? (q.to ? "timeout" : q.f ? "failed" : "?")} ${q.ms}ms -${q.ago}s`).join("; "));
    }
    if (r.queryErrors.length) {
      log.error(`[client-error] ${r.errorId} queryErrors: ` + r.queryErrors.map((q) => `${q.key} "${q.msg}" -${q.ago}s`).join("; "));
    }
  });
}

/** Attach the per-window listeners (call for the main window after it is created). */
export function watchRenderer(wc: WebContents): void {
  let consoleBudget = 0;
  let budgetResetAt = Date.now();
  wc.on("console-message", (_e, level, message, line, sourceId) => {
    if (level < 3) return; // errors only
    const now = Date.now();
    if (now - budgetResetAt > 60_000) { consoleBudget = 0; budgetResetAt = now; }
    if (++consoleBudget > 30) return; // a polling loop failing must not flood the file
    log.error(`[renderer console] ${String(message).slice(0, 1000)} (${String(sourceId).split("/").pop()}:${line})`);
  });
  wc.on("render-process-gone", (_e, details) => {
    log.error(`[renderer] process gone: reason=${details.reason} exitCode=${details.exitCode}`);
  });
  wc.on("unresponsive", () => log.error("[renderer] window unresponsive"));
  wc.on("responsive", () => log.info("[renderer] window responsive again"));
  wc.on("did-fail-load", (_e, code, desc, url) => log.error(`[renderer] failed to load ${url}: ${code} ${desc}`));
}

/** Path of the log file, for messages. */
export function diagnosticLogPath(): string {
  try { return (log.transports.file as any).getFile().path as string; } catch { return "%APPDATA%\\Bagicha POS\\logs\\main.log"; }
}
