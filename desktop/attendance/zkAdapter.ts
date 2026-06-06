/**
 * zkAdapter.ts — thin wrapper over `node-zklib` (ZKTeco/eSSL TCP protocol) for the K30 Pro.
 *
 * node-zklib is loaded with a DYNAMIC import so a missing or firmware-incompatible
 * library degrades gracefully (logged + agent stays idle) instead of crashing the
 * Electron main process. All timestamps are read as device-LOCAL wall-clock — the
 * agent runs on the restaurant LAN PC, whose local time equals the device's time —
 * so there is no timezone conversion anywhere in the pipeline.
 */

export interface RawPunch {
  biometricId: string; // device user-ID (links to staff_profiles.biometricId)
  date: string;        // YYYY-MM-DD (device-local)
  time: string;        // HH:MM      (device-local)
  ts: number;          // epoch ms — for the sync cursor + dedupe only
}

export interface DeviceInfo {
  users: number;
  logs: number;
  logCapacity?: number;
}

const pad = (n: number) => String(n).padStart(2, "0");

function fmt(d: Date): { date: string; time: string } {
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

/** Normalise a raw device log/live event into a RawPunch (field names vary by firmware). */
function toPunch(r: any, fallback?: Date): RawPunch | null {
  const id = r?.deviceUserId ?? r?.userId ?? r?.user_id ?? r?.uid;
  if (id == null || id === "") return null;
  const raw = r?.recordTime ?? r?.timestamp ?? r?.time ?? fallback;
  if (raw == null) return null;
  const d = raw instanceof Date ? raw : new Date(raw);
  if (isNaN(d.getTime())) return null;
  const { date, time } = fmt(d);
  return { biometricId: String(id), date, time, ts: d.getTime() };
}

export class ZkAdapter {
  private zk: any = null;

  constructor(private ip: string, private port: number) {}

  async connect(): Promise<void> {
    const mod: any = await import("node-zklib");
    const ZKLib: any = mod?.default ?? mod;
    // new ZKLib(ip, port, timeout, inport)
    this.zk = new ZKLib(this.ip, this.port, 10_000, 4000);
    await this.zk.createSocket();
  }

  async getInfo(): Promise<DeviceInfo> {
    const info: any = await this.zk.getInfo();
    return {
      users: Number(info?.userCounts ?? 0),
      logs: Number(info?.logCounts ?? 0),
      logCapacity: info?.logCapacity != null ? Number(info.logCapacity) : undefined,
    };
  }

  async getAttendances(): Promise<RawPunch[]> {
    const res: any = await this.zk.getAttendances();
    const rows: any[] = res?.data ?? (Array.isArray(res) ? res : []);
    const out: RawPunch[] = [];
    for (const r of rows) {
      const p = toPunch(r);
      if (p) out.push(p);
    }
    return out;
  }

  onLivePunch(cb: (p: RawPunch) => void): void {
    try {
      this.zk?.getRealTimeLogs((data: any) => {
        const p = toPunch(data, new Date());
        if (p) cb(p);
      });
    } catch {
      // Live capture unsupported on this firmware — the reconcile loop still covers it.
    }
  }

  async disconnect(): Promise<void> {
    try {
      await this.zk?.disconnect();
    } catch {
      /* ignore */
    }
    this.zk = null;
  }
}
