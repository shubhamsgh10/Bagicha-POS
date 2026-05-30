# Print Reliability Overhaul — Design Spec

**Date:** 2026-05-30  
**Status:** Approved  
**Scope:** Electron print path, server print routes, print queue, native printer layer

---

## Problem

The KOT and Bill print flow has three interconnected bugs causing:
1. **Triple (or more) prints** — 3 Windows print queue entries created per single KOT click
2. **17-second hangs / 500 errors** — PowerShell session init timeout visible to the user
3. **Slow / unreliable prints** — PS `Add-Type` C# compilation takes 5–30 seconds on old PCs; sometimes never completes

### Root Cause Trace

```
KOT click
  → POST /api/print/kot
  → Express server (canExecutePrintOnServer = true in dev/local mode)
  → server/printService.ts: sendToUsbPrinter()
  → shared/print/windowsRawPrint.ts: sendRawToWindowsQueue()
  → shared/print/persistentPs.ts: sendRawFast()
  → PowerShell Add-Type C# compile (5–30s on slow PC)
  → TIMEOUT → 500 error after 15–60s

Meanwhile Electron print queue: NEVER REACHED
```

The server races the Electron process to the USB printer and loses. The Electron print queue (with its persistence, retry, and IPC) is completely bypassed.

**Secondary bug:** `executor.ts` `withRetry` (3 attempts: 0s/2s/5s) sends to Windows `WritePrinter` 3 times on failure. Each call creates a separate Windows print queue entry → triple prints.

---

## Architecture Fix

### Core Principle

> **USB printers are physically connected to the Electron machine. The Express server must never try to reach a USB printer.**

This is the Petpooja model: UI → IPC → background print daemon (Electron main) → native printer driver → hardware. The server only generates the buffer and returns it as a `printJob`. The print daemon (Electron main + PrintQueue) handles everything else.

### Correct Flow (After Fix)

```
[KOT click] → POST /api/print/kot
                 │
     ┌───────────┴─────────────┐
     │ USB printer?            │ Network printer?
     ▼                         ▼
Return { printJob }       Server sends TCP directly
     │                    Return { printed: true }
     ▼
Electron JS (printGateway.ts)
  → window.electronAPI.print(job)
     │
     ▼
IPC → Electron main → PrintQueue.enqueue()
     │
     ▼  [dedup check]
executePrintJob() — single attempt
     │
     ▼
nativePrint.ts (@thiagoelg/node-printer)
  → printDirect({ type: 'RAW', printer, data })
     │
     ▼
Windows WritePrinter (~10ms)
     │
     ▼
POST /api/print/ack → update DB snapshot
```

**Same path for both KOT and Bill.** Both `/api/print/kot` and `/api/print/bill` follow this identical logic.

---

## All Bugs Fixed

| # | Bug | Root Cause | Fix |
|---|-----|------------|-----|
| 1 | 17s hang / 500 error on KOT/Bill | Server tries PS session for USB | Server always returns `printJob` for USB; never calls `sendToUsbPrinter` |
| 2 | Triple prints | `withRetry` in executor sends to WritePrinter 3× on failure | Remove `withRetry`; one attempt per queue job |
| 3 | PS session slow init (5–30s) | `Add-Type` C# compilation on every PS startup | Replace entire PS layer with `@thiagoelg/node-printer` native addon (~10ms) |
| 4 | Duplicate prints from double-click or auto-KOT race | No dedup in print queue | Queue skips new job if same `orderId+ackType` already pending/processing |
| 5 | Stale jobs from previous session blocking queue | Queue loads all pending jobs from disk on start | Drop jobs older than 5 minutes on queue load |
| 6 | `windowsPrinterQueueExists` WMI check on every print | Runs on every `sendToUsbPrinter` call | Eliminated — replaced by `node-printer` which uses queue name directly |
| 7 | Server PS session separate from Electron PS session | `canExecutePrintOnServer = true` in dev/local | USB → always `printJob`; server no longer touches PS |

---

## Native Print Layer

### Technology: `@thiagoelg/node-printer`

- Maintained fork of `node-printer`; uses N-API (stable across Electron versions)
- Calls Windows `OpenPrinter` / `WritePrinter` / `ClosePrinter` directly from C++
- No PowerShell, no C# compilation, no session management
- ~10ms per print on Windows
- Project already uses `usb` native addon — same build infrastructure applies

### Why Not PS/C# (Current Approach)

| | PS + C# (current) | node-printer (new) |
|---|---|---|
| First print latency | 5–30s (Add-Type) | ~10ms |
| Subsequent prints | ~15ms (if session alive) | ~10ms |
| Session management | Complex (init/crash/restart) | None needed |
| Build requirements | None | C++ build tools (same as `usb` package) |
| Reliability | Session can exit unexpectedly | Native — always available |

### Fallback Strategy

If `node-printer` fails (printer offline, driver error), the print queue retries up to 3 times (0s → 2s → 5s → 10s), then marks job `failed` and logs it. The cashier sees a toast via the health warning IPC channel.

---

## Files Changed

| File | Change |
|------|--------|
| `server/printRoutes.ts` | USB printers: remove `canExecutePrintOnServer` guard, always return `printJob` for both KOT + Bill |
| `server/printService.ts` | `canExecutePrintOnServer()`: return `false` when printer is USB type |
| `desktop/print/nativePrint.ts` | **NEW** — `@thiagoelg/node-printer` wrapper: `sendRawToUsbQueue(name, buffer)` |
| `desktop/print/usbSend.ts` | Replace PS/windowsRawPrint import with `nativePrint.ts` |
| `desktop/print/executor.ts` | Remove `withRetry` — single attempt only |
| `desktop/print/printQueue.ts` | Add dedup on `enqueue`; drop jobs >5 min on `load` |
| `desktop/main.ts` | Remove `warmPrinterSession`, `closePrinterSession` imports/calls |
| `package.json` | Add `@thiagoelg/node-printer`; add `electron-rebuild` postinstall script |
| `electron-builder.yml` | Add `nodeGypRebuild: false` + `npmRebuild: true` for native addon packaging |

### Files Made Obsolete (kept but no longer in active path)

- `shared/print/persistentPs.ts` — PS session no longer needed
- `shared/print/windowsRawPrint.ts` — replaced by `nativePrint.ts` in Electron path

These files stay in the repo (the server might use them on non-Windows/network printer paths) but are removed from the USB print hot path.

---

## Print Queue Deduplication Logic

```typescript
enqueue(spec): string {
  // Dedup: skip if same orderId+ackType already in flight
  if (spec.orderId && spec.ackType) {
    const duplicate = this.queue.find(
      j => j.orderId === spec.orderId &&
           j.ackType === spec.ackType &&
           (j.status === 'pending' || j.status === 'processing' || j.status === 'retrying')
    );
    if (duplicate) {
      console.log(`[printQueue] Dedup: job for order ${spec.orderId}/${spec.ackType} already queued`);
      return duplicate.id;
    }
  }
  // ... normal enqueue
}
```

---

## Server Route Logic (KOT + Bill — identical pattern)

```
POST /api/print/kot (and /api/print/bill):

1. Find configured printer
2. If no printer → browserPrint: true (unchanged)
3. If printer.type === 'network' AND canExecutePrintOnServer():
     → sendToNetworkPrinter() → return { printed: true }
4. If printer.type === 'usb' (any environment):
     → return { printJob: toPrintJob(...), pendingAck: true }  ← ALWAYS
```

The `canExecutePrintOnServer` function is updated to return `false` for USB printers regardless of environment. Network printers continue to work via direct TCP from the server.

---

## Queue Stale Job Cleanup

```typescript
private load(): void {
  const STALE_MS = 5 * 60 * 1000; // 5 minutes
  const now = Date.now();
  this.queue = saved
    .filter(j => j.status === 'pending' || j.status === 'retrying' || j.status === 'processing')
    .filter(j => now - j.createdAt < STALE_MS); // drop stale jobs
}
```

---

## Verification

1. Click KOT → Windows print queue shows **exactly 1 job** (not 3)
2. KOT print completes in **<500ms** from button click (not 17 seconds)
3. Click Bill → same path, same speed
4. Kill Electron mid-print → restart → old pending jobs from previous session are dropped (>5 min old)
5. Double-click KOT fast → only 1 print job enqueued (dedup fires)
6. Network printer: still prints directly via server TCP (no Electron needed)
7. No printer configured: browser fallback print still works

---

## What Is NOT Changed

- `client/src/pages/POS.tsx` — KOT/Bill button handlers unchanged
- `client/src/components/SettlementDialog.tsx` — unchanged
- `client/src/lib/printGateway.ts` — unchanged
- `shared/print/generators.ts` — ESC/POS buffer generation unchanged
- `server/routes.ts` — main routes unchanged
- `server/printRoutes.ts` KOT/Bill buffer generation — unchanged (only the USB dispatch decision changes)
- Browser fallback printing — unchanged
- Network printer path — unchanged
