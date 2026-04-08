import pkg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set. Check your .env file.");
}

const { Pool } = pkg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },

  // ── Network resilience settings ───────────────────────────────────────────
  // Raise connection timeout so restricted/slow networks have time to connect
  connectionTimeoutMillis: 15_000,   // 15s to establish connection
  idleTimeoutMillis:       30_000,   // close idle clients after 30s
  max:                     10,        // keep pool small to avoid exhaustion

  // TCP keepalive — prevents idle connections from being silently dropped
  // by firewalls or NAT on restricted networks
  keepAlive:               true,
  keepAliveInitialDelayMillis: 10_000,
});

// ── Connection health check + friendly error on startup ───────────────────────
pool.on("error", (err) => {
  console.error("[DB] Unexpected pool error:", err.message);
  if (
    err.message.includes("ECONNREFUSED") ||
    err.message.includes("ETIMEDOUT") ||
    err.message.includes("ENOTFOUND") ||
    err.message.includes("getaddrinfo")
  ) {
    console.error(
      "\n[DB] ⚠️  Cannot reach Supabase. This usually means your network blocks\n" +
      "    port 5432. Switch to the Supabase Connection Pooler (port 6543):\n" +
      "    Dashboard → Settings → Database → Connection pooling → URI\n" +
      "    Then update DATABASE_URL in your .env file.\n"
    );
  }
});

export const db = drizzle(pool, { schema });

// ── Retry helper for transient network failures ───────────────────────────────
export async function withRetry<T>(
  fn: () => Promise<T>,
  attempts = 3,
  delayMs = 1_000
): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err: any) {
      const isNetworkErr =
        err.message?.includes("ETIMEDOUT") ||
        err.message?.includes("ECONNREFUSED") ||
        err.message?.includes("Connection terminated") ||
        err.message?.includes("connection timeout");

      if (isNetworkErr && i < attempts - 1) {
        const wait = delayMs * Math.pow(2, i); // exponential back-off
        console.warn(`[DB] Network error, retrying in ${wait}ms… (${i + 1}/${attempts})`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      throw err;
    }
  }
  throw new Error("withRetry: unreachable");
}
