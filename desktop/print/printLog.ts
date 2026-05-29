import fs from "fs";
import path from "path";

const MAX_ENTRIES = 500;

export interface PrintLogEntry {
  timestamp: number;
  type: "kot" | "bill" | "test";
  printerId: string;
  printerName?: string;
  status: "sent" | "success" | "failed" | "retry";
  orderId?: number;
  error?: string;
}

export class PrintLog {
  private entries: PrintLogEntry[] = [];
  private logFile: string;

  constructor(userDataPath: string) {
    this.logFile = path.join(userDataPath, "print-log.json");
    this.load();
  }

  private load(): void {
    try {
      const raw = fs.readFileSync(this.logFile, "utf8");
      this.entries = JSON.parse(raw);
    } catch {
      this.entries = [];
    }
  }

  private save(): void {
    try {
      fs.writeFileSync(this.logFile, JSON.stringify(this.entries, null, 2), "utf8");
    } catch (e) {
      console.warn("[printLog] save failed:", e);
    }
  }

  append(entry: Omit<PrintLogEntry, "timestamp">): void {
    this.entries.push({ ...entry, timestamp: Date.now() });
    if (this.entries.length > MAX_ENTRIES) {
      this.entries = this.entries.slice(-MAX_ENTRIES);
    }
    this.save();
  }

  getRecent(n = 50): PrintLogEntry[] {
    return this.entries.slice(-n);
  }
}
