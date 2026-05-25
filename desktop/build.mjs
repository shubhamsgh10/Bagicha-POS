import * as esbuild from "esbuild";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");
const outdir = path.join(__dirname, "dist");

const isPackagedDesktopBuild =
  process.env.ELECTRON_BUILD === "1" || process.env.NODE_ENV === "production";

dotenv.config({ path: path.join(repoRoot, ".env") });
if (isPackagedDesktopBuild) {
  dotenv.config({ path: path.join(repoRoot, ".env.production") });
}

// Dev Electron loads http://localhost:5000 — main process should use that origin, not a baked remote URL.
const apiBaseUrl = isPackagedDesktopBuild
  ? (process.env.VITE_API_BASE_URL || process.env.API_BASE_URL || "").trim()
  : "";

if (isPackagedDesktopBuild) {
  if (apiBaseUrl) {
    console.log("[desktop] API base for main process:", apiBaseUrl.replace(/\/$/, ""));
  } else {
    console.warn(
      "[desktop] VITE_API_BASE_URL not set — packaged app needs it in .env at build time",
    );
  }
} else {
  console.log("[desktop] Dev build — main process API base follows VITE_DEV_SERVER_URL");
}

/** Electron preload must be CommonJS (no ESM in isolated preload context). */
await esbuild.build({
  entryPoints: [path.join(__dirname, "preload.ts")],
  outfile: path.join(outdir, "preload.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["electron"],
  sourcemap: true,
});

/** Main process: ESM bundle (root package.json has "type": "module"). */
await esbuild.build({
  entryPoints: [path.join(__dirname, "main.ts")],
  outfile: path.join(outdir, "main.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  packages: "external",
  sourcemap: true,
  define: {
    "process.env.VITE_API_BASE_URL": JSON.stringify(apiBaseUrl),
    "process.env.API_BASE_URL": JSON.stringify(apiBaseUrl),
  },
});

console.log("[desktop] Built dist/preload.cjs and dist/main.mjs");
