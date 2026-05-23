import fs from "fs";
import path from "path";

const root = path.join(process.cwd(), "client", "src");

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (/\.(tsx?)$/.test(ent.name)) out.push(p);
  }
  return out;
}

const skip = new Set([
  path.normalize("client/src/lib/api.ts"),
  path.normalize("client/src/lib/queryClient.ts"),
]);

for (const file of walk(root)) {
  const rel = path.relative(process.cwd(), file).replace(/\\/g, "/");
  if (skip.has(rel)) continue;

  let c = fs.readFileSync(file, "utf8");
  const orig = c;
  if (!/fetch\s*\(\s*['"`]\/api/.test(c)) continue;

  c = c.replace(/fetch\s*\(\s*'\/api/g, "fetch(apiUrl('/api");
  c = c.replace(/fetch\s*\(\s*"\/api/g, 'fetch(apiUrl("/api');
  c = c.replace(/fetch\s*\(\s*`\/api/g, "fetch(apiUrl(`/api");

  if (c !== orig && !/from ['"]@\/lib\/api['"]/.test(c)) {
    const importLine = "import { apiUrl } from '@/lib/api';\n";
    const m = c.match(/^import .+;\n/m);
    if (m) {
      const idx = c.indexOf(m[0]) + m[0].length;
      c = c.slice(0, idx) + importLine + c.slice(idx);
    } else {
      c = importLine + c;
    }
  }

  if (c !== orig) {
    fs.writeFileSync(file, c);
    console.log("updated", rel);
  }
}
