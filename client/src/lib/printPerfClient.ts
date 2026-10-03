import { createStageTimer, type StageTimer } from "@shared/printPerf";

/**
 * POS tap → printed-response marks. One tap at a time (a POS has one cart). Logs a single
 * `[print-perf]` console line per tap so real-use numbers (Vercel, Electron host) can be read
 * from DevTools without any test data. Never throws, never affects the print flow.
 */
let current: { kind: string; timer: StageTimer } | null = null;

export function startPrintTap(kind: string): void {
  current = { kind, timer: createStageTimer() };
}

export function timePrintStage<T>(name: string, fn: () => Promise<T>): Promise<T> {
  return current ? current.timer.time(name, fn) : fn();
}

export function endPrintTap(): void {
  if (!current) return;
  try {
    console.log(current.timer.toLogLine(`tap:${current.kind}`));
  } finally {
    current = null;
  }
}
