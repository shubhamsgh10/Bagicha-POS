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
