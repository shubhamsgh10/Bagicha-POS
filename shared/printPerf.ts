/**
 * Dependency-free stage timer shared by the server print pipeline (Server-Timing header +
 * [print-perf] log line) and the POS tap marks. Pure: the clock is injected so
 * scripts/verify-print-perf.ts can drive it deterministically.
 */
export interface StageTimer {
  /** Runs fn, adds its wall time to stage `name` (summed when a name repeats), rethrows on failure. */
  time<T>(name: string, fn: () => PromiseLike<T>): Promise<T>;
  add(name: string, ms: number): void;
  /** A view that writes `${prefix}_${name}` into the SAME underlying timer. */
  scoped(prefix: string): StageTimer;
  stages(): Record<string, number>;
  totalMs(): number;
  /** `db_order;dur=12.3, …, total;dur=40.2` — the Server-Timing header value. */
  toServerTiming(): string;
  /** `[print-perf] <label> db_order=12.3 … total=40.2` */
  toLogLine(label: string): string;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const safeName = (n: string) => n.replace(/[^A-Za-z0-9_-]/g, "_");

export function createStageTimer(now: () => number = () => performance.now()): StageTimer {
  const start = now();
  const acc = new Map<string, number>();

  const build = (prefix: string): StageTimer => {
    const key = (name: string) => safeName(prefix ? `${prefix}_${name}` : name);
    const add = (name: string, ms: number) => {
      const k = key(name);
      acc.set(k, (acc.get(k) ?? 0) + ms);
    };
    return {
      async time<T>(name: string, fn: () => PromiseLike<T>): Promise<T> {
        const t0 = now();
        try {
          return await fn();
        } finally {
          add(name, now() - t0);
        }
      },
      add,
      scoped: (p: string) => build(prefix ? `${prefix}_${p}` : p),
      stages() {
        const out: Record<string, number> = {};
        for (const [k, v] of Array.from(acc)) out[k] = round1(v);
        return out;
      },
      totalMs: () => round1(now() - start),
      toServerTiming() {
        const parts = Array.from(acc).map(([k, v]) => `${k};dur=${round1(v)}`);
        parts.push(`total;dur=${round1(now() - start)}`);
        return parts.join(", ");
      },
      toLogLine(label: string) {
        const parts = Array.from(acc).map(([k, v]) => `${k}=${round1(v)}`);
        parts.push(`total=${round1(now() - start)}`);
        return `[print-perf] ${label} ${parts.join(" ")}`;
      },
    };
  };

  return build("");
}

/**
 * A POS print tap (click → print result handled) at or over this is reported to the audit trail as
 * `perf.slow_print` (client/src/lib/printPerfClient.ts) — a healthy tap is ~0.5–0.8 s on Vercel.
 */
export const SLOW_PRINT_TAP_MS = 3000;

/**
 * Parses a Server-Timing header (`save;dur=180.2, insert_job;dur=9, app;dur=212, inst;desc="age=60s req=9"`)
 * into stage durations plus the instance description. Read from the save response's HEADERS: the
 * Electron thin client runs on a file:// origin, where Resource Timing hides Server-Timing even with
 * Timing-Allow-Origin: * (checked in Chrome), but fetch can read it via Access-Control-Expose-Headers.
 */
export function parseServerTiming(header: string | null | undefined): { dur: Record<string, number>; inst: string | null } {
  const dur: Record<string, number> = {};
  let inst: string | null = null;
  if (!header) return { dur, inst };
  for (const part of header.split(",")) {
    const [rawName, ...params] = part.trim().split(";");
    const name = rawName?.trim();
    if (!name) continue;
    for (const p of params) {
      const eq = p.indexOf("=");
      if (eq < 0) continue;
      const k = p.slice(0, eq).trim();
      const v = p.slice(eq + 1).trim();
      if (k === "dur" && v !== "" && Number.isFinite(Number(v))) dur[name] = Number(v);
      if (k === "desc" && name === "inst") inst = v.replace(/^"|"$/g, "");
    }
  }
  return { dur, inst };
}
