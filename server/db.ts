import pkg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { PGlite } from '@electric-sql/pglite';
import * as schema from "@shared/schema";
import { dbSslConfig, stripSslParams } from "./dbSsl";

const { Pool } = pkg;
type Db = NodePgDatabase<typeof schema>;

// Shop-PC local mode must NEVER reach the shared cloud database: it requires PGlite and drops
// DATABASE_URL (which `-r dotenv/config` may have loaded from .env) before anything can use it.
if (process.env.BAGICHA_LOCAL_MODE === "1") {
  if (process.env.BAGICHA_DB !== "pglite") {
    throw new Error("BAGICHA_LOCAL_MODE=1 requires BAGICHA_DB=pglite (refusing to open the cloud database)");
  }
  delete process.env.DATABASE_URL;
}

// BAGICHA_DB=pglite runs the same server code on an in-process Postgres (PGlite) for the
// local-first shop PC. Unset = the shared cloud database on DATABASE_URL, as before.
const USE_PGLITE = process.env.BAGICHA_DB === "pglite";

function createCloudDb(): { pool: pkg.Pool; db: Db } {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set. Check your .env file.");
  }

  // TLS: verified against DATABASE_CA_CERT when it is set, otherwise encrypted but unverified
  // (the old behaviour). See server/dbSsl.ts. A set-but-unreadable value refuses to boot
  // rather than silently connecting unverified.
  const sslCfg = dbSslConfig(process.env);
  if (sslCfg.mode === "invalid") throw new Error(`[DB] ${sslCfg.error}`);
  if (sslCfg.mode === "unverified") {
    console.warn("[DB] TLS certificate NOT verified — set DATABASE_CA_CERT to Supabase's CA to verify it.");
  } else {
    console.log("[DB] TLS certificate verification ON (DATABASE_CA_CERT).");
  }

  const pool = new Pool({
    // sslmode/sslrootcert in the URL would REPLACE the ssl object below (pg merges the parsed
    // URL over the config), so they are removed and the switch above always decides.
    connectionString: stripSslParams(process.env.DATABASE_URL),
    ssl: sslCfg.ssl,

    // ── Network resilience settings ──────────────────────────────────────────────────────────
    // Raise connection timeout so restricted/slow networks have time to connect
    connectionTimeoutMillis: 15_000,   // 15s to establish connection
    idleTimeoutMillis:       30_000,   // close idle clients after 30s
    max:                     10,        // keep pool small to avoid exhaustion

    // TCP keepalive — prevents idle connections from being silently dropped
    // by firewalls or NAT on restricted networks
    keepAlive:               true,
    keepAliveInitialDelayMillis: 10_000,
  });

  // ── Connection health check + friendly error on startup ───────────────────────────────────────
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

  return { pool, db: drizzle(pool, { schema }) };
}

async function createLocalDb(): Promise<{ client: PGlite; db: Db }> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle: drizzlePglite } = await import("drizzle-orm/pglite");
  // No dir = in-memory (spike); the local server will pass a userData path.
  const client = new PGlite(process.env.BAGICHA_PGLITE_DIR || undefined);
  await client.waitReady;
  // Same query API; the cast keeps every call site typed as before.
  return { client, db: drizzlePglite(client, { schema }) as unknown as Db };
}

// tsconfig has no target (ES5 default) so tsc rejects top-level await; esbuild/tsx (ESM) run it fine.
// @ts-ignore TS1378
const local = USE_PGLITE ? await createLocalDb() : null;
const cloud = USE_PGLITE ? null : createCloudDb();

export const pool: pkg.Pool | null = cloud ? cloud.pool : null;
export const localClient: PGlite | null = local ? local.client : null;
export const db: Db = local ? local.db : cloud!.db;

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
