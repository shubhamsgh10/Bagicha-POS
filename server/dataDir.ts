/**
 * dataDir.ts — resolves the writable base directory for server-managed files
 * (restaurant-settings.json, automation-config.json, baileys-auth/, …).
 *
 * Defaults to process.cwd() (dev / `npm start` — files live in the repo root).
 * The embedded-host Electron build sets BAGICHA_DATA_DIR to the OS userData
 * folder (app.getPath("userData")), because a packaged app's cwd is read-only.
 */

import path from "path";

export function dataDir(): string {
  return process.env.BAGICHA_DATA_DIR || process.cwd();
}

export function dataPath(...segments: string[]): string {
  return path.join(dataDir(), ...segments);
}
