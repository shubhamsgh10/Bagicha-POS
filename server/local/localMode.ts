// Local-first shop-PC mode: the same server, answering screen reads from its own PGlite copy and
// forwarding everything else to the cloud API. Off unless BAGICHA_LOCAL_MODE=1 — nothing under
// server/local runs (or is even loaded) otherwise.

export interface LocalModeConfig {
  pgliteDir: string;
  /** No trailing slash. */
  cloudUrl: string;
  deviceToken: string;
  /** Optional Vercel Deployment Protection bypass secret. */
  cloudBypass?: string;
}

export function isLocalMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.BAGICHA_LOCAL_MODE === "1";
}

/** Parses and validates the local-mode env. Throws one clear message listing everything missing. */
export function readLocalModeConfig(env: NodeJS.ProcessEnv = process.env): LocalModeConfig {
  const problems: string[] = [];
  if (env.BAGICHA_DB !== "pglite") problems.push("BAGICHA_DB=pglite");
  const pgliteDir = (env.BAGICHA_PGLITE_DIR ?? "").trim();
  if (!pgliteDir) problems.push("BAGICHA_PGLITE_DIR (an on-disk folder for the local database)");
  const cloudUrl = (env.BAGICHA_CLOUD_URL ?? "").trim().replace(/\/+$/, "");
  if (!cloudUrl) problems.push("BAGICHA_CLOUD_URL (e.g. https://<app>.vercel.app)");
  else if (!/^https?:\/\//i.test(cloudUrl)) problems.push("BAGICHA_CLOUD_URL must start with http:// or https://");
  const deviceToken = (env.BAGICHA_DEVICE_TOKEN ?? "").trim();
  if (!deviceToken) problems.push("BAGICHA_DEVICE_TOKEN (create one in Admin -> Shop PC sync devices)");
  if (problems.length) {
    throw new Error(`BAGICHA_LOCAL_MODE=1 needs: ${problems.join("; ")}`);
  }
  const cloudBypass = (env.BAGICHA_CLOUD_BYPASS ?? "").trim();
  return { pgliteDir, cloudUrl, deviceToken, ...(cloudBypass ? { cloudBypass } : {}) };
}
