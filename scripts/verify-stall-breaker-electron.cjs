/**
 * Manual check (Windows, Git Bash): the REAL timedFetch stall breaker in a REAL Electron 33 window
 * against a local HTTP/2 server behind a TCP proxy that can silently blackhole established connections
 * (no bytes, no close — the shop's dead-connection case), plus a real Pusher WebSocket.
 *
 * Run from the repo root (needs openssl on PATH — Git Bash has it):
 *   env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron scripts/verify-stall-breaker-electron.cjs
 * (VS Code's terminal sets ELECTRON_RUN_AS_NODE=1, which turns Electron into plain Node.)
 * Pass = every line PASS and "RESULT: PASS". Touches no database.
 */
const { app, BrowserWindow, ipcMain, session } = require("electron");
const http2 = require("http2");
const net = require("net");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const esbuild = require("esbuild");
require("dotenv").config({ quiet: true });

const ROOT = path.resolve(__dirname, "..");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "stall-breaker-"));

// Throwaway self-signed cert, trusted for 127.0.0.1 only (setCertificateVerifyProc below).
execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes",
  "-keyout", path.join(TMP, "key.pem"), "-out", path.join(TMP, "cert.pem"), "-days", "1", "-subj", "/CN=127.0.0.1"],
  { stdio: "ignore", env: { ...process.env, MSYS_NO_PATHCONV: "1" } });

const bundle = esbuild.buildSync({
  entryPoints: [path.join(ROOT, "scripts/lib/stall-breaker-page.ts")],
  bundle: true, format: "iife", platform: "browser", target: "chrome120", write: false,
  define: { "import.meta.env.VITE_API_BASE_URL": '""' },
  logLevel: "error",
}).outputFiles[0].text;

const pusherCfg = process.env.VITE_PUSHER_KEY && process.env.VITE_PUSHER_CLUSTER
  ? { key: process.env.VITE_PUSHER_KEY, cluster: process.env.VITE_PUSHER_CLUSTER } : null;
const PAGE = `<!doctype html><meta charset=utf-8><script>window.__PUSHER__=${JSON.stringify(pusherCfg)};</script><script>${bundle}</script>`;

fs.writeFileSync(path.join(TMP, "preload.cjs"),
  `const { contextBridge, ipcRenderer } = require("electron");
   contextBridge.exposeInMainWorld("electronAPI", { isElectron: true, resetConnections: () => ipcRenderer.invoke("net:reset-connections") });`);

// ── HTTP/2 server ──
const seen = { keyed: new Map(), unkeyed: 0 };
const h2 = http2.createSecureServer({ key: fs.readFileSync(path.join(TMP, "key.pem")), cert: fs.readFileSync(path.join(TMP, "cert.pem")) });
h2.on("stream", (stream, headers) => {
  stream.resume();
  const p = String(headers[":path"]).split("?")[0];
  const json = (body, status = 200) => { stream.respond({ ":status": status, "content-type": "application/json" }); stream.end(JSON.stringify(body)); };
  if (p === "/") { stream.respond({ ":status": 200, "content-type": "text/html" }); return stream.end(PAGE); }
  if (p === "/api/ping") { stream.respond({ ":status": 204 }); return stream.end(); }
  if (p === "/api/data") return json({ ok: true });
  if (p === "/api/save") {
    const key = headers["idempotency-key"];
    if (key) seen.keyed.set(key, (seen.keyed.get(key) || 0) + 1); else seen.unkeyed++;
    return json({ ok: true });
  }
  if (p === "/api/slow") return void setTimeout(() => json({ ok: true }), 2500);
  stream.respond({ ":status": 404 }); stream.end();
});

// ── TCP proxy: blackholeExisting() silently stops forwarding on every connection opened so far ──
let connSeq = 0, blackholeUpTo = 0;
const proxy = net.createServer((client) => {
  const id = ++connSeq;
  const upstream = net.connect(h2.address().port, "127.0.0.1");
  const dead = () => id <= blackholeUpTo;
  client.on("data", (d) => { if (!dead()) upstream.write(d); });
  upstream.on("data", (d) => { if (!dead()) client.write(d); });
  client.on("close", () => upstream.destroy());
  upstream.on("close", () => client.destroy());
  client.on("error", () => {}); upstream.on("error", () => {});
});
const blackholeExisting = () => { blackholeUpTo = connSeq; };

const results = [];
const check = (name, ok, detail) => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail !== undefined ? `  — ${detail}` : ""}`);
};

async function run(win) {
  const exec = (code) => win.webContents.executeJavaScript(code, true);
  await exec("new Promise((r) => setTimeout(r, 1500))"); // let Pusher connect

  let r = await exec(`runCase("warm")`);
  check("warm-up request works (HTTP/2 session up)", r.ok && r.status === 200, JSON.stringify(r));

  blackholeExisting();
  r = await exec(`runCase("keyed")`);
  const keyed = Array.from(seen.keyed.values());
  check("keyed save on a dead connection recovers", r.ok && r.status === 200, `${r.ms} ms`);
  check("…within 3.5 s", r.ok && r.ms < 3500, `${r.ms} ms`);
  check("…with exactly one connection reset", r.resets === 1, `resets ${r.resets}`);
  check("…and the server saw it exactly once", keyed.length === 1 && keyed[0] === 1, JSON.stringify(keyed));

  blackholeExisting();
  r = await exec(`runCase("unkeyed")`);
  check("unkeyed save fails with the clear message", !r.ok && /connection dropped/i.test(String(r.error)), r.error);
  check("…and is never resent", seen.unkeyed === 0, `server saw ${seen.unkeyed}`);

  // The previous case's reset closed every connection: open a fresh one first, or the GET below would
  // simply open a new (never blackholed) connection and not test a stall at all.
  await exec(`runCase("warm")`);
  blackholeExisting();
  r = await exec(`runCase("get")`);
  check("GET on a dead connection recovers within 3.5 s", r.ok && r.status === 200 && r.ms < 3500, `${r.ms} ms`);
  check("…after exactly one connection reset", r.resets === 1, `resets ${r.resets}`);

  r = await exec(`runCase("slow")`);
  check("slow but alive request: no reset", r.ok && r.status === 200 && r.resets === 0, `${r.ms} ms, resets ${r.resets}`);

  const p = await exec("pusherState()");
  check("Pusher WebSocket survives the resets", p === "OPEN + pong" || p.startsWith("skipped"), p);
}

app.whenReady().then(() => {
  session.defaultSession.setCertificateVerifyProc((req, cb) => cb(req.hostname === "127.0.0.1" ? 0 : -3));
  ipcMain.handle("net:reset-connections", (e) => e.sender.session.closeAllConnections());
  h2.listen(0, "127.0.0.1", () => proxy.listen(0, "127.0.0.1", async () => {
    const win = new BrowserWindow({ show: false, webPreferences: { preload: path.join(TMP, "preload.cjs"), contextIsolation: true, sandbox: false } });
    const killer = setTimeout(() => { console.log("FAIL  timed out after 60 s"); app.exit(1); }, 60_000);
    try {
      await win.loadURL(`https://127.0.0.1:${proxy.address().port}/`);
      await run(win);
    } catch (e) {
      check("script error", false, e && e.stack ? e.stack : String(e));
    }
    clearTimeout(killer);
    const failed = results.filter((ok) => !ok).length;
    console.log(failed === 0 ? "\nRESULT: PASS ✅" : `\nRESULT: FAIL ❌ (${failed})`);
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
    app.exit(failed === 0 ? 0 : 1);
  }));
});
