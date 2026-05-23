/**
 * Dev workflow: Express API + Vite UI on :5000, then Electron window.
 * Usage: node desktop/dev.mjs  (npm run dev:electron)
 */
import { spawn } from "child_process";
import { createRequire } from "module";
import http from "http";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const require = createRequire(import.meta.url);
const electronBin = require("electron");

const API_PORT = process.env.PORT || "5000";
// Same as `npm run dev` — API + React on one port (not Vite :5173 alone)
const DEV_URL = process.env.VITE_DEV_SERVER_URL || `http://localhost:${API_PORT}`;

const tsxCli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
const serverEntry = path.join(root, "server", "index.ts");

function waitForServer(url, maxMs = 120_000) {
  const host = new URL(url);
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(
        {
          hostname: host.hostname,
          port: host.port || (host.protocol === "https:" ? 443 : 80),
          path: "/api/auth/context",
          timeout: 3000,
        },
        (res) => {
          res.resume();
          resolve();
        },
      );
      req.on("error", () => {
        if (Date.now() - start > maxMs) {
          reject(new Error(`Server did not start at ${url} within ${maxMs / 1000}s`));
          return;
        }
        setTimeout(attempt, 500);
      });
      req.on("timeout", () => {
        req.destroy();
        if (Date.now() - start > maxMs) reject(new Error("Timed out waiting for server"));
        else setTimeout(attempt, 500);
      });
    };
    attempt();
  });
}

function spawnProc(cmd, args, extraEnv = {}, hideWindow = false) {
  return spawn(cmd, args, {
    cwd: root,
    stdio: "inherit",
    shell: false,
    windowsHide: hideWindow,
    env: { ...process.env, ...extraEnv },
  });
}

console.log("[dev:electron] Building desktop shell…");
await import(pathToFileURL(path.join(__dirname, "build.mjs")).href);

console.log(`[dev:electron] Starting API + UI (npm run dev equivalent on :${API_PORT})…`);
const api = spawnProc(
  process.execPath,
  [tsxCli, "-r", "dotenv/config", serverEntry],
  { PORT: API_PORT, NODE_ENV: "development" },
  true,
);

api.on("error", (err) => {
  console.error("[dev:electron] Failed to start server:", err.message);
  process.exit(1);
});

let electron = null;

const cleanup = () => {
  if (electron && !electron.killed) {
    try {
      electron.kill();
    } catch {
      /* ignore */
    }
  }
  if (!api.killed) {
    try {
      api.kill();
    } catch {
      /* ignore */
    }
  }
};

process.on("SIGINT", () => {
  cleanup();
  process.exit(0);
});
process.on("SIGTERM", cleanup);

try {
  await waitForServer(DEV_URL);
  console.log(`[dev:electron] Server ready at ${DEV_URL}`);
  console.log(`[dev:electron] Launching Electron…`);

  electron = spawnProc(
    electronBin,
    ["."],
    {
      NODE_ENV: "development",
      VITE_DEV_SERVER_URL: DEV_URL,
      ELECTRON_ENABLE_LOGGING: "1",
    },
    false,
  );

  electron.on("spawn", () => {
    console.log(
      `[dev:electron] Electron pid ${electron.pid} — window should load ${DEV_URL}`,
    );
  });

  electron.on("error", (err) => {
    console.error("[dev:electron] Failed to start Electron:", err.message);
    cleanup();
    process.exit(1);
  });

  electron.on("exit", (code) => {
    console.log(`[dev:electron] Electron exited (${code ?? 0})`);
    cleanup();
    process.exit(code ?? 0);
  });
} catch (err) {
  cleanup();
  console.error(err?.message ?? err);
  process.exit(1);
}
