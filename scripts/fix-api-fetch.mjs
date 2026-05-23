import fs from "fs";
import path from "path";

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (/\.(tsx?)$/.test(ent.name)) out.push(p);
  }
  return out;
}

const re = /fetch\(apiUrl\(([^,]+),\s*(\{)/g;

for (const file of walk(path.join(process.cwd(), "client", "src"))) {
  let c = fs.readFileSync(file, "utf8");
  const fixed = c.replace(re, "fetch(apiUrl($1), $2");
  if (fixed !== c) {
    fs.writeFileSync(file, fixed);
    console.log("fixed", path.relative(process.cwd(), file));
  }
}
