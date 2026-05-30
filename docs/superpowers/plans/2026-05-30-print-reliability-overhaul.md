# Print Reliability Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix triple-print bug, 17-second KOT hang, and slow/unreliable thermal printing by routing all USB prints through Electron's native print queue and replacing PowerShell/C# with `@thiagoelg/node-printer` native addon.

**Architecture:** The Express server generates ESC/POS buffers for both KOT and Bill, but for USB printers it now always returns a `{ printJob }` JSON response instead of trying to print directly. The Electron main process receives this via IPC, enqueues it in the persistent `PrintQueue`, and executes it via `@thiagoelg/node-printer` which calls Windows `WritePrinter` directly in ~10ms — no PowerShell, no C# compilation. Network printers continue to be handled by the server via direct TCP.

**Tech Stack:** Electron 33 (Node 20), `@thiagoelg/node-printer` (native C++ addon, N-API), TypeScript ESM, existing PrintQueue + IPC infrastructure.

---

## Context for the Implementer

This codebase is a monorepo restaurant POS. The three layers that matter for this plan:

- **`server/`** — Express app. `printRoutes.ts` handles `POST /api/print/kot` and `POST /api/print/bill`. Currently it calls `sendToPrinter()` for USB printers which spawns a PowerShell process (slow/broken).
- **`desktop/`** — Electron main process. `printQueue.ts` + `executor.ts` + `usbSend.ts` handle the Electron side of printing. Currently `usbSend.ts` calls `shared/print/windowsRawPrint.ts` which uses a persistent PowerShell session.
- **`shared/`** — Shared utilities. `persistentPs.ts` is the PowerShell session manager (will be removed from the hot path).

**The single most important architectural fix:** In `server/printRoutes.ts`, the condition `if (canExecutePrintOnServer() && escPosOk)` causes the server to try printing USB printers directly. Adding `&& printer.type !== 'usb'` means USB prints always return `{ printJob }` to Electron, which is the correct path.

All `npm run check` commands run from the project root (`e:\Claude Code\BagichaOrderMaster\BagichaOrderMaster`).

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `package.json` | Modify | Add `@thiagoelg/node-printer` + postinstall rebuild |
| `electron-builder.yml` | Modify | Unpack `.node` native files from ASAR |
| `desktop/print/nativePrint.ts` | **Create** | Wrapper: `sendRawViaNativePrinter(name, buffer)` |
| `desktop/print/usbSend.ts` | Modify | Use `nativePrint.ts`; remove PS/WMI calls |
| `desktop/print/executor.ts` | Modify | Remove `withRetry`; single attempt only |
| `desktop/print/printQueue.ts` | Modify | Dedup on enqueue; drop stale jobs on load |
| `server/printRoutes.ts` | Modify | Add `&& printer.type !== 'usb'` guard for both KOT + Bill |
| `desktop/main.ts` | Modify | Remove `warmPrinterSession` / `closePrinterSession` |

**Not changed:** `shared/print/persistentPs.ts`, `shared/print/windowsRawPrint.ts` (kept for reference; no longer in the hot path), `client/src/lib/printGateway.ts`, `client/src/pages/POS.tsx`, `shared/print/generators.ts`.

---

## Task 1 — Install @thiagoelg/node-printer and Configure Packaging

**Files:**
- Modify: `package.json`
- Modify: `electron-builder.yml`

This installs the native Windows print addon and configures Electron packaging to handle `.node` binaries (which cannot live inside an ASAR archive).

- [ ] **Step 1: Install the package**

```powershell
cd "e:\Claude Code\BagichaOrderMaster\BagichaOrderMaster"
npm install @thiagoelg/node-printer
```

Expected: package added to `node_modules/@thiagoelg/node-printer`. If it prints "prebuild-install warn" it means no prebuilt binary was found and it is building from source — that is fine, but it requires C++ build tools (Visual Studio Build Tools or MSVC). If the build fails, run: `npm install --global windows-build-tools` and retry. Expected success output ends with something like `added 1 package`.

- [ ] **Step 2: Add postinstall rebuild to package.json**

Open `package.json`. In the `"scripts"` section, add the `postinstall` entry shown below. Keep all existing scripts intact.

```json
"scripts": {
  "postinstall": "electron-rebuild -f -w @thiagoelg/node-printer",
  "dev": "tsx -r dotenv/config server/index.ts",
  ...
}
```

Also add `electron-rebuild` to `devDependencies`:

```json
"devDependencies": {
  "electron-rebuild": "^3.2.9",
  ...
}
```

Then install it:

```powershell
npm install --save-dev electron-rebuild
```

- [ ] **Step 3: Run rebuild for the current Electron version**

```powershell
npx electron-rebuild -f -w @thiagoelg/node-printer
```

Expected output: `✔ Rebuild Complete` or similar. If it says the ABI matches, the prebuilt binary is used (fast). If it compiles from source, it takes 1–3 minutes.

- [ ] **Step 4: Configure electron-builder.yml to unpack native .node files**

Native `.node` addon binaries cannot be inside an ASAR archive. Add `asarUnpack` to `electron-builder.yml`:

```yaml
appId: com.bagicha.pos
productName: Bagicha POS
executableName: BagichaPOS
copyright: Copyright © Bagicha

publish:
  - provider: github
    owner: shubhamsgh10
    repo: Bagicha-POS
    releaseType: release
directories:
  output: release
  buildResources: desktop/icons
files:
  - dist/public/**/*
  - desktop/dist/**/*
  - desktop/icons/icon.png
  - desktop/icons/icon.ico
  - shared/print/scripts/**/*
  - package.json
asar: true
asarUnpack:
  - "**/*.node"
extraMetadata:
  main: desktop/dist/main.mjs

icon: desktop/icons/icon.png

win:
  icon: desktop/icons/icon.ico
  signAndEditExecutable: false
  target:
    - target: nsis
      arch:
        - x64
nsis:
  oneClick: false
  perMachine: false
  allowToChangeInstallationDirectory: true
  createDesktopShortcut: true
  shortcutName: Bagicha POS

mac:
  icon: desktop/icons/icon.png
  category: public.app-category.business
  target:
    - dmg
    - zip
  hardenedRuntime: true
  gatekeeperAssess: false

linux:
  icon: desktop/icons/icon.png
  category: Office
  target:
    - AppImage
    - deb
```

- [ ] **Step 5: Verify TypeScript check passes**

```powershell
npm run check
```

Expected: no errors (we haven't imported the new package yet, so no type issues).

- [ ] **Step 6: Commit**

```powershell
git add package.json electron-builder.yml package-lock.json
git commit -m "chore: install @thiagoelg/node-printer native addon for direct Windows printing

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 2 — Create desktop/print/nativePrint.ts

**Files:**
- Create: `desktop/print/nativePrint.ts`

This file is the single place where `@thiagoelg/node-printer` is used. Because the desktop code is compiled as ESM (`"type": "module"` in package.json) but `@thiagoelg/node-printer` is a CommonJS native addon, we use `createRequire` to load it.

- [ ] **Step 1: Create the file**

Create `desktop/print/nativePrint.ts` with this exact content:

```typescript
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);

interface PrintDirectOptions {
  data: Buffer | string;
  printer: string;
  type: string;
  success: (jobId: number) => void;
  error: (err: string) => void;
}

interface NodePrinterModule {
  printDirect: (options: PrintDirectOptions) => void;
  getPrinters: () => Array<{ name: string; isDefault: boolean; status: number }>;
}

// Resolve the native addon path. When packaged with electron-builder (asar + asarUnpack),
// .node files live in app.asar.unpacked; require() resolves this automatically.
const nodePrinter: NodePrinterModule = require("@thiagoelg/node-printer");

/**
 * Send raw ESC/POS bytes directly to a Windows printer queue.
 * Uses Win32 WritePrinter via native C++ addon — no PowerShell, no C# compilation.
 * ~10ms latency per job.
 */
export function sendRawViaNativePrinter(printerName: string, data: Buffer): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    nodePrinter.printDirect({
      data,
      printer: printerName,
      type: "RAW",
      success: () => resolve(),
      error: (err: string) => reject(new Error(`node-printer: ${err}`)),
    });
  });
}

/**
 * List all installed Windows printer queues (for diagnostics).
 */
export function listNativePrinters(): Array<{ name: string; isDefault: boolean; status: number }> {
  try {
    return nodePrinter.getPrinters();
  } catch {
    return [];
  }
}
```

- [ ] **Step 2: Run TypeScript check**

```powershell
npm run check
```

Expected: no errors. If you see `Cannot find module '@thiagoelg/node-printer'`, that means the package wasn't installed in Step 1 of Task 1 — run `npm install @thiagoelg/node-printer` again.

- [ ] **Step 3: Commit**

```powershell
git add desktop/print/nativePrint.ts
git commit -m "feat: add nativePrint.ts — node-printer wrapper for direct Windows raw printing

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 3 — Update desktop/print/usbSend.ts

**Files:**
- Modify: `desktop/print/usbSend.ts`

Replace the PowerShell/WMI path with `nativePrint.ts`. Remove `windowsPrinterQueueExists` calls (no need to check on every print — if the queue doesn't exist, `node-printer` will return an error and the print queue retries). Keep the libusb path for Linux/Mac unchanged.

- [ ] **Step 1: Replace file content**

Replace the entire content of `desktop/print/usbSend.ts` with:

```typescript
import type { PrinterConfig } from "../types.js";
import { sendRawViaNativePrinter } from "./nativePrint.js";
import { resolveWindowsQueueForPrinter } from "./usbNamesWindows.js";
import { sendViaLibusb } from "./usbLibusb.js";

/**
 * Send ESC/POS bytes to a USB printer.
 *
 * Windows: uses @thiagoelg/node-printer (native Win32 WritePrinter, ~10ms).
 *   - If windowsQueueName is saved, use it directly.
 *   - Otherwise resolve from VID/PID via WMI (one-time scan result).
 *
 * Linux/Mac: use libusb (unchanged).
 */
export async function sendToUsbPrinter(printer: PrinterConfig, data: Buffer): Promise<void> {
  if (process.platform === "win32") {
    // Use the saved queue name if available (set by printer scan in Settings)
    const savedQueue = printer.windowsQueueName?.trim();
    if (savedQueue) {
      await sendRawViaNativePrinter(savedQueue, data);
      return;
    }

    // Fallback: resolve queue name from VID/PID (requires printer to have been scanned)
    if (printer.vendorId != null && printer.productId != null) {
      const queueName = await resolveWindowsQueueForPrinter(
        printer.vendorId,
        printer.productId,
        undefined,
      );
      if (!queueName) {
        throw new Error(
          `No Windows print queue found for printer "${printer.name}". ` +
            `Go to Settings → Printer Setup → Detect Installed Printers, ` +
            `select your printer and Save.`,
        );
      }
      await sendRawViaNativePrinter(queueName, data);
      return;
    }

    throw new Error(
      `USB printer "${printer.name}" has no Windows queue name configured. ` +
        `Go to Settings → Printer Setup → Detect Installed Printers, select your printer and Save.`,
    );
  }

  // Linux / Mac — use libusb (unchanged)
  if (!printer.vendorId || !printer.productId) {
    throw new Error(`USB printer "${printer.name}" is missing vendorId or productId`);
  }
  try {
    await sendViaLibusb(printer.vendorId, printer.productId, data);
  } catch (err: any) {
    const raw = err?.message ?? String(err);
    if (raw.includes("LIBUSB")) {
      throw new Error(
        `USB print failed (${raw}). On Windows, use the Bagicha desktop app with the printer installed in Settings.`,
      );
    }
    throw err;
  }
}
```

- [ ] **Step 2: Run TypeScript check**

```powershell
npm run check
```

Expected: no errors.

- [ ] **Step 3: Commit**

```powershell
git add desktop/print/usbSend.ts
git commit -m "refactor: replace PS/WMI path in usbSend with node-printer native addon

Removes windowsPrinterQueueExists WMI check on every print.
Windows USB printing now: saved queue name -> sendRawViaNativePrinter (~10ms).

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 4 — Remove withRetry from desktop/print/executor.ts

**Files:**
- Modify: `desktop/print/executor.ts`

`withRetry` sends to the Windows printer 3 times on failure (delays 0s/2s/5s), creating 3 separate Windows print queue entries. The `PrintQueue` already has its own retry logic (MAX_RETRIES=3). Remove the double-retry.

- [ ] **Step 1: Replace file content**

Replace the entire content of `desktop/print/executor.ts` with:

```typescript
import net from "net";
import type { PrintJob, PrinterConfig } from "../types.js";

export async function sendToNetworkPrinter(ip: string, port: number, data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: ip, port }, () => {
      socket.write(data, (err) => {
        if (err) { socket.destroy(); reject(err); return; }
        socket.end();
        resolve();
      });
    });
    socket.setTimeout(5000, () => {
      socket.destroy();
      reject(new Error(`Printer at ${ip}:${port} did not respond within 5 seconds`));
    });
    socket.on("error", reject);
  });
}

import { sendToUsbPrinter } from "./usbSend.js";

export async function sendToPrinter(printer: PrinterConfig, data: Buffer): Promise<void> {
  if (printer.type === "network") {
    if (!printer.ip) throw new Error(`Network printer "${printer.name}" has no IP configured`);
    await sendToNetworkPrinter(printer.ip, printer.port ?? 9100, data);
  } else {
    await sendToUsbPrinter(printer, data);
  }
}

/**
 * Execute one print job. Single attempt — PrintQueue handles retries at the job level.
 * (Previously had withRetry which caused 3 Windows queue entries per failure.)
 */
export async function executePrintJob(
  job: PrintJob,
  printers: PrinterConfig[],
): Promise<void> {
  if (job.encoding !== "escpos-base64") {
    throw new Error(`Unsupported print encoding: ${job.encoding}`);
  }
  const printer = printers.find((p) => p.id === job.printerId);
  if (!printer) {
    throw new Error(`Printer "${job.printerId}" not found in settings`);
  }
  const buffer = Buffer.from(job.data, "base64");
  await sendToPrinter(printer, buffer);
}
```

- [ ] **Step 2: Run TypeScript check**

```powershell
npm run check
```

Expected: no errors.

- [ ] **Step 3: Commit**

```powershell
git add desktop/print/executor.ts
git commit -m "fix: remove withRetry from executePrintJob — eliminates triple Windows print queue entries

withRetry (0s/2s/5s) was creating 3 separate Windows print jobs per failure.
PrintQueue already has MAX_RETRIES=3 at the job level.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 5 — Add Deduplication and Stale Job Cleanup to printQueue.ts

**Files:**
- Modify: `desktop/print/printQueue.ts`

Two changes:
1. **Dedup on enqueue**: If a `pending/processing/retrying` job for the same `orderId+ackType` already exists, return its ID instead of creating a duplicate. This prevents double-clicks and auto-KOT races from creating two jobs.
2. **Stale cleanup on load**: Jobs persisted to disk from a previous session older than 5 minutes are dropped on app start. A 5-minute-old stuck job is never going to succeed and will only block the queue.

- [ ] **Step 1: Update the `load` private method**

In `desktop/print/printQueue.ts`, find the `private load(): void` method (around line 51) and replace it with:

```typescript
private load(): void {
  try {
    const raw = fs.readFileSync(this.queueFile, "utf8");
    const saved: QueuedJob[] = JSON.parse(raw);
    const STALE_MS = 5 * 60 * 1000; // 5 minutes — stale jobs from a crashed session
    const now = Date.now();
    this.queue = saved
      .filter((j) => j.status === "pending" || j.status === "retrying" || j.status === "processing")
      .filter((j) => now - j.createdAt < STALE_MS);
    // Reset any jobs that were mid-processing when the app crashed
    for (const j of this.queue) {
      if (j.status === "processing") j.status = "pending";
    }
    if (this.queue.length > 0) {
      console.log(`[printQueue] Resumed ${this.queue.length} pending job(s) from disk`);
      setTimeout(() => this.processNext(), 1_000);
    }
  } catch {
    // No saved queue or invalid JSON — start fresh
  }
}
```

- [ ] **Step 2: Update the `enqueue` public method**

In `desktop/print/printQueue.ts`, find the `enqueue` method (around line 81) and replace it with:

```typescript
enqueue(spec: Omit<QueuedJob, "id" | "createdAt" | "status" | "retries">): string {
  // Dedup: if a job for the same order+type is already in-flight, skip
  if (spec.orderId && spec.ackType) {
    const duplicate = this.queue.find(
      (j) =>
        j.orderId === spec.orderId &&
        j.ackType === spec.ackType &&
        (j.status === "pending" || j.status === "processing" || j.status === "retrying"),
    );
    if (duplicate) {
      console.log(
        `[printQueue] Dedup: job for order ${spec.orderId}/${spec.ackType} already queued (${duplicate.id})`,
      );
      return duplicate.id;
    }
  }

  const job: QueuedJob = {
    ...spec,
    id: randomBytes(8).toString("hex"),
    createdAt: Date.now(),
    status: "pending",
    retries: 0,
  };
  this.queue.push(job);
  this.persist();
  setImmediate(() => this.processNext());
  return job.id;
}
```

- [ ] **Step 3: Run TypeScript check**

```powershell
npm run check
```

Expected: no errors.

- [ ] **Step 4: Commit**

```powershell
git add desktop/print/printQueue.ts
git commit -m "fix: add dedup + stale job cleanup to PrintQueue

Dedup: same orderId+ackType already pending/processing → skip new enqueue.
Stale: jobs >5 min old dropped on load (crashed session leftovers).

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 6 — Fix server/printRoutes.ts: USB Always Returns printJob

**Files:**
- Modify: `server/printRoutes.ts`

This is the most important server-side fix. Currently, `canExecutePrintOnServer()` returns `true` in dev/local mode, causing the server to attempt USB printing via PowerShell — which hangs for 15-60 seconds and fails. Adding `&& printer.type !== 'usb'` ensures USB printers always return the `printJob` JSON payload for Electron to handle.

This fix applies identically in **two places**: the KOT route and the Bill route.

- [ ] **Step 1: Fix the KOT route**

In `server/printRoutes.ts`, find the KOT route's server-side print block (around line 365). It currently looks like:

```typescript
if (canExecutePrintOnServer() && escPosOk) {
  await sendToPrinter(printer, buffer);
  await commitKotState();
  return res.json({ printed: true, isDelta, reprint });
}

if (canExecutePrintOnServer() && !escPosOk) {
  return res.json({
    printed: false,
    browserPrint: true,
    reason: "non_escpos_printer",
    ...
  });
}
```

Change both conditions to add `&& printer.type !== 'usb'`:

```typescript
if (canExecutePrintOnServer() && escPosOk && printer.type !== "usb") {
  await sendToPrinter(printer, buffer);
  await commitKotState();
  return res.json({ printed: true, isDelta, reprint });
}

if (canExecutePrintOnServer() && !escPosOk && printer.type !== "usb") {
  return res.json({
    printed: false,
    browserPrint: true,
    reason: "non_escpos_printer",
    message: nonEscPosPrinterMessage(printer),
    isDelta,
    reprint,
    orderNumber: order.orderNumber,
    tableNumber: order.tableNumber,
    items: browserItems,
    orderId,
  });
}
```

- [ ] **Step 2: Fix the Bill route**

In `server/printRoutes.ts`, find the Bill route's server-side print block (around line 474). It currently looks like:

```typescript
if (canExecutePrintOnServer() && escPosOk) {
  await sendToPrinter(printer, buffer);
  await commitBillState();
  return res.json({ printed: true });
}

if (canExecutePrintOnServer() && !escPosOk) {
  return res.json({
    printed: false,
    browserPrint: true,
    message: nonEscPosPrinterMessage(printer),
    orderId,
  });
}
```

Change both conditions to add `&& printer.type !== 'usb'`:

```typescript
if (canExecutePrintOnServer() && escPosOk && printer.type !== "usb") {
  await sendToPrinter(printer, buffer);
  await commitBillState();
  return res.json({ printed: true });
}

if (canExecutePrintOnServer() && !escPosOk && printer.type !== "usb") {
  return res.json({
    printed: false,
    browserPrint: true,
    message: nonEscPosPrinterMessage(printer),
    orderId,
  });
}
```

- [ ] **Step 3: Run TypeScript check**

```powershell
npm run check
```

Expected: no errors.

- [ ] **Step 4: Verify the change conceptually**

After this change, the server routes behave as follows:
- **USB printer + Electron running**: Returns `{ printJob: {...} }` → Electron queue handles it ✓
- **Network printer + server running**: Server sends TCP directly (unchanged) ✓  
- **No printer configured**: Returns `{ browserPrint: true }` (unchanged) ✓
- **Non-ESC/POS USB printer**: Returns `{ browserPrint: true }` (unchanged) ✓

- [ ] **Step 5: Commit**

```powershell
git add server/printRoutes.ts
git commit -m "fix: USB printers always return printJob from server — never attempt direct PS print

Root cause of 17s hang: server was calling sendToPrinter() for USB printers which
spawned PowerShell + C# compilation. USB printers must go through Electron queue.
Applies to both KOT and Bill routes.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 7 — Clean Up desktop/main.ts: Remove PS Session Calls

**Files:**
- Modify: `desktop/main.ts`

The PowerShell session warm-up and close calls are no longer needed since `usbSend.ts` now uses `node-printer` instead of `persistentPs.ts`. Remove them to eliminate the unnecessary startup work.

- [ ] **Step 1: Remove the warmPrinterSession import and startup call**

In `desktop/main.ts`, find and remove this import line:

```typescript
import { warmPrinterSession, closePrinterSession } from "../shared/print/persistentPs.js";
```

- [ ] **Step 2: Remove the warm call in app.whenReady()**

In `desktop/main.ts`, find the `app.whenReady().then()` block. Remove this line:

```typescript
warmPrinterSession().catch((e) => console.warn("[electron] printer session warm:", e));
```

- [ ] **Step 3: Remove the closePrinterSession call**

In `desktop/main.ts`, find and remove this line:

```typescript
app.on("will-quit", () => closePrinterSession());
```

- [ ] **Step 4: Run TypeScript check**

```powershell
npm run check
```

Expected: no errors. If TypeScript complains about unused imports in `persistentPs.ts` itself, that's fine — the file is still valid, just no longer imported from `main.ts`.

- [ ] **Step 5: Commit**

```powershell
git add desktop/main.ts
git commit -m "chore: remove PS session warm/close from Electron main — no longer needed

PS session was for the old windowsRawPrint path which is now replaced by
@thiagoelg/node-printer. USB prints no longer need PowerShell at all.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 8 — End-to-End Verification

No code changes — this task verifies the entire system works correctly.

- [ ] **Step 1: Start the dev server and Electron app**

Terminal 1:
```powershell
npm run dev
```
Wait until you see `[express] serving on port 5000`.

Terminal 2:
```powershell
npm run dev:electron
```
Wait for the Electron window to open.

- [ ] **Step 2: Verify KOT — single print job**

1. Log in, go to POS
2. Select a table, add 2-3 items
3. Click **KOT**
4. Open Windows Print Queue: Start → search "Printers & Scanners" → click your thermal printer → "Open print queue"
5. **Expected:** Exactly **1** print job appears (not 3). It prints and disappears.
6. Check server terminal — **must NOT see** `[Print/KOT] Error: PowerShell session init timed out`. Instead you'll see the normal request log.

- [ ] **Step 3: Verify Bill — single print job**

1. On the same table with the KOT already sent, click **Bill**
2. **Expected:** Exactly **1** bill print job in Windows queue. Prints in <2 seconds.
3. Check server terminal — no PowerShell timeout errors.

- [ ] **Step 4: Verify double-click dedup**

1. Add items to a new table
2. Double-click **KOT** quickly
3. **Expected:** Only 1 KOT prints (dedup fires for the second click)
4. Check Electron console (DevTools → Console) — you should see: `[printQueue] Dedup: job for order X/kot already queued`

- [ ] **Step 5: Verify network printer is unchanged (if applicable)**

If a network printer is configured: KOT + Bill should still print directly from the server via TCP (not through Electron queue). The `printer.type !== 'usb'` check only redirects USB printers.

- [ ] **Step 6: Run final TypeScript check**

```powershell
npm run check
```

Expected: zero errors.

---

## Rollback Notes

If `@thiagoelg/node-printer` fails to install or compile:
1. Revert Task 1 (`git revert` or manually undo `package.json` changes)
2. The old PS session path is still intact in `shared/print/persistentPs.ts` and `shared/print/windowsRawPrint.ts`
3. Revert `desktop/print/usbSend.ts` to use `sendRawToWindowsQueue` from `windowsRawPrint.ts`
4. Task 6 (server fix) should **still be kept** — it fixes the 17s hang regardless of which printer layer is used
5. Task 4 (remove withRetry) should **still be kept** — it fixes the triple print regardless
