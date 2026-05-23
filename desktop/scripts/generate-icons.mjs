/**
 * Generate desktop/icons/icon.png (512) and icon.ico from client/public/bagicha-logo.svg.
 * Run: npm run icons
 */
import { Resvg } from "@resvg/resvg-js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import toIco from "to-ico";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..", "..");
const svgPath = path.join(root, "client", "public", "bagicha-logo.svg");
const outDir = path.join(__dirname, "..", "icons");

fs.mkdirSync(outDir, { recursive: true });

const svg = fs.readFileSync(svgPath, "utf8");

function renderPng(size) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: size },
    background: "#ffffff",
  });
  return resvg.render().asPng();
}

const sizes = [1024, 512, 256, 128, 64, 48, 32, 16];
const pngBySize = Object.fromEntries(sizes.map((s) => [s, renderPng(s)]));

fs.writeFileSync(path.join(outDir, "icon.png"), pngBySize[512]);
fs.writeFileSync(path.join(outDir, "icon@2x.png"), pngBySize[1024]);

const ico = await toIco([
  pngBySize[256],
  pngBySize[128],
  pngBySize[64],
  pngBySize[48],
  pngBySize[32],
  pngBySize[16],
]);
fs.writeFileSync(path.join(outDir, "icon.ico"), ico);

console.log("[icons] Wrote desktop/icons/icon.png, icon@2x.png, icon.ico");
