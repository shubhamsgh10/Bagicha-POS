import * as esbuild from "esbuild";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outdir = path.join(__dirname, "dist");

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
});

console.log("[desktop] Built dist/preload.cjs and dist/main.mjs");
