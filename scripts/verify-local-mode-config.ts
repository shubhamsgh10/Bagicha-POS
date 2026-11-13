// DB-free: the desktop app's local-mode rules (desktop/localMode.ts) and the supervisor that
// starts / watches the local server child (desktop/localServer.ts), driven with throwaway fake children.
import fs from "fs";
import net from "net";
import os from "os";
import path from "path";
import {
  isValidDeviceToken,
  normalizeCloudUrl,
  resolveEnableConfig,
  newLocalNonce,
  nonceMatches,
  isReadyStatusBody,
  parseLocalHostSettings,
  buildLocalChildEnv,
  decideAfterExit,
  readyTimedOut,
} from "../desktop/localMode";
import { LocalServer, probeLocalStatus } from "../desktop/localServer";
import { readLocalModeConfig } from "../server/local/localMode";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  - " + detail : ""}`);
  if (!ok) failures++;
}

const TOKEN = "a".repeat(64);

// ---- token / cloud url -------------------------------------------------------
check("64 hex token is valid", isValidDeviceToken(TOKEN) && isValidDeviceToken("0123456789abcdefABCDEF".padEnd(64, "0")));
for (const bad of ["", "abc", "g".repeat(64), TOKEN + "0", TOKEN.slice(1), 42, null, undefined]) {
  check(`token ${JSON.stringify(bad)} rejected`, !isValidDeviceToken(bad));
}
check("https cloud url accepted, normalised to origin", normalizeCloudUrl(" https://app.vercel.app/ ") === "https://app.vercel.app");
check("http localhost accepted", normalizeCloudUrl("http://localhost:5000") === "http://localhost:5000");
check("http 127.0.0.1 accepted", normalizeCloudUrl("http://127.0.0.1:9") === "http://127.0.0.1:9");
for (const bad of ["http://app.vercel.app", "ftp://x.com", "https://u:p@x.com", "https://x.com/api", "https://x.com/?a=1", "x.com", "", null, 5]) {
  check(`cloud url ${JSON.stringify(bad)} rejected`, normalizeCloudUrl(bad) === null);
}

// ---- enable request (the renderer sends only the token) ------------------------------
const BAKED = "https://baked.example.app";
const okReq = resolveEnableConfig({ deviceToken: TOKEN.toUpperCase() }, {}, BAKED);
check("token-only request accepted (token lowercased), URL from the baked base", okReq.ok && okReq.deviceToken === TOKEN && okReq.cloudUrl === BAKED);
check("renderer-supplied cloudUrl is ignored", (() => {
  const r = resolveEnableConfig({ deviceToken: TOKEN, cloudUrl: "https://evil.example" }, {}, BAKED);
  return r.ok && r.cloudUrl === BAKED;
})());
check("renderer cloudUrl cannot rescue a missing baked URL", !resolveEnableConfig({ deviceToken: TOKEN, cloudUrl: "https://evil.example" }, {}, "").ok);
check("a hand-edited host-config cloudUrl wins over the baked base", (() => {
  const r = resolveEnableConfig({ deviceToken: TOKEN }, { cloudUrl: "https://preview.vercel.app/" }, BAKED);
  return r.ok && r.cloudUrl === "https://preview.vercel.app";
})());
check("renderer cloudUrl never beats the host-config one", (() => {
  const r = resolveEnableConfig({ deviceToken: TOKEN, cloudUrl: "https://evil.example" }, { cloudUrl: "https://preview.vercel.app" }, BAKED);
  return r.ok && r.cloudUrl === "https://preview.vercel.app";
})());
check("an invalid hand-edited cloudUrl is an error (no silent fallback to something else)", !resolveEnableConfig({ deviceToken: TOKEN }, { cloudUrl: "http://evil.example" }, BAKED).ok);
check("no config and no baked URL is rejected", !resolveEnableConfig({ deviceToken: TOKEN }, {}, "").ok);
check("http non-loopback baked URL rejected", !resolveEnableConfig({ deviceToken: TOKEN }, {}, "http://a.app").ok);
check("http loopback baked URL accepted", resolveEnableConfig({ deviceToken: TOKEN }, {}, "http://127.0.0.1:9").ok);
check("bad token rejected", !resolveEnableConfig({ deviceToken: "nope" }, {}, BAKED).ok);
check("non-object rejected", !resolveEnableConfig(null, {}, BAKED).ok && !resolveEnableConfig("x", {}, BAKED).ok);
check("error text never contains the token", (() => { const r = resolveEnableConfig({ deviceToken: TOKEN }, {}, ""); return !r.ok && !r.error.includes(TOKEN); })());

// ---- host-config parsing -------------------------------------------------------
check("localMode absent -> not enabled", !parseLocalHostSettings({ DATABASE_URL: "x" }).enabled);
check("localMode false -> not enabled", !parseLocalHostSettings({ localMode: false, cloudUrl: "https://a.app", deviceToken: TOKEN }).enabled);
check("valid trio -> enabled", (() => { const r = parseLocalHostSettings({ localMode: true, cloudUrl: "https://a.app/", deviceToken: TOKEN }); return r.enabled && r.settings?.cloudUrl === "https://a.app"; })());
check("no cloudUrl in the file -> baked base is used", (() => { const r = parseLocalHostSettings({ localMode: true, deviceToken: TOKEN }, BAKED); return r.enabled && r.settings?.cloudUrl === BAKED; })());
check("no cloudUrl in the file and no baked base -> disabled with a problem", (() => { const r = parseLocalHostSettings({ localMode: true, deviceToken: TOKEN }); return !r.enabled && !!r.problem; })());
check("localMode on but no token -> disabled with a problem", (() => { const r = parseLocalHostSettings({ localMode: true, cloudUrl: "https://a.app" }); return !r.enabled && !!r.problem; })());
check("localMode on but bad url -> disabled with a problem", (() => { const r = parseLocalHostSettings({ localMode: true, cloudUrl: "http://evil.example", deviceToken: TOKEN }); return !r.enabled && !!r.problem; })());
check("non-object file -> not enabled", !parseLocalHostSettings(null).enabled && !parseLocalHostSettings("x").enabled);

// ---- child env ------------------------------------------------------------------
const NONCE = newLocalNonce();
check("nonce is 32 hex chars and differs per call", /^[0-9a-f]{32}$/.test(NONCE) && newLocalNonce() !== NONCE);
check("nonceMatches: right / wrong / missing / non-string / wrong length", nonceMatches(NONCE, NONCE) && !nonceMatches(NONCE, "0".repeat(32)) &&
  !nonceMatches(NONCE, undefined) && !nonceMatches(NONCE, 5) && !nonceMatches(NONCE, NONCE + "0") && !nonceMatches("", ""));
check("status body ready only with localMode:true and the nonce", isReadyStatusBody({ localMode: true, nonce: NONCE }, NONCE) &&
  !isReadyStatusBody({ localMode: true }, NONCE) && !isReadyStatusBody({ localMode: true, nonce: "x" }, NONCE) &&
  !isReadyStatusBody({ localMode: false, nonce: NONCE }, NONCE) && !isReadyStatusBody(null, NONCE));
const parent: NodeJS.ProcessEnv = {
  DATABASE_URL: "postgres://prod", database_ca_cert: "x", BACKGROUND_JOBS: "on", SESSION_SECRET: "parent-secret",
  HOST: "0.0.0.0", BAGICHA_EMBEDDED: "1", PATH: "/bin", VITE_API_BASE_URL: "https://a.app",
};
const env = buildLocalChildEnv(parent, {
  cloudUrl: "https://a.app", deviceToken: TOKEN, pgliteDir: "/u/localdb", dataDir: "/u", port: "5179", sessionSecret: "child-secret", nonce: NONCE,
});
check("child env has no DATABASE_URL", !("DATABASE_URL" in env) && !Object.keys(env).some((k) => k.toUpperCase() === "DATABASE_URL"));
check("child env drops DATABASE_CA_CERT (any case)", !Object.keys(env).some((k) => k.toUpperCase() === "DATABASE_CA_CERT"));
check("child env has no BACKGROUND_JOBS", !("BACKGROUND_JOBS" in env));
check("child env has no BAGICHA_EMBEDDED", !("BAGICHA_EMBEDDED" in env));
check("child env session secret is the generated one", env.SESSION_SECRET === "child-secret");
check("child env binds loopback", env.HOST === "127.0.0.1");
check("child env keeps unrelated vars", env.PATH === "/bin");
check("child env local-mode contract", env.BAGICHA_LOCAL_MODE === "1" && env.BAGICHA_DB === "pglite" && env.BAGICHA_PGLITE_DIR === "/u/localdb" &&
  env.BAGICHA_CLOUD_URL === "https://a.app" && env.BAGICHA_DEVICE_TOKEN === TOKEN && env.PORT === "5179" && env.NODE_ENV === "production" &&
  env.BAGICHA_DATA_DIR === "/u" && env.ELECTRON_RUN_AS_NODE === "1");
check("child env carries the launch nonce", env.BAGICHA_LOCAL_NONCE === NONCE);
check("a parent-supplied BAGICHA_LOCAL_NONCE cannot override it", buildLocalChildEnv({ ...parent, BAGICHA_LOCAL_NONCE: "parent" }, { cloudUrl: "https://a.app", deviceToken: TOKEN, pgliteDir: "/u/l", dataDir: "/u", port: 1, sessionSecret: "s", nonce: NONCE }).BAGICHA_LOCAL_NONCE === NONCE);
check("server accepts the child env as a valid local-mode config", (() => {
  try { const c = readLocalModeConfig(env); return c.cloudUrl === "https://a.app" && c.deviceToken === TOKEN; } catch { return false; }
})());
check("parent env untouched", parent.DATABASE_URL === "postgres://prod" && parent.BACKGROUND_JOBS === "on");

// ---- fallback rules ---------------------------------------------------------------
check("not ready before 45 s", !readyTimedOut(1000, 1000 + 44_999));
check("not ready at 45 s -> fall back", readyTimedOut(1000, 1000 + 45_000));
const t0 = 1_000_000;
check("1st crash restarts after 1 s", (() => { const d = decideAfterExit([t0], t0); return d.action === "restart" && d.delayMs === 1000; })());
check("3rd crash still restarts (4 s backoff)", (() => { const d = decideAfterExit([t0, t0 + 1, t0 + 2], t0 + 2); return d.action === "restart" && d.delayMs === 4000; })());
check("4th crash within 5 min falls back", decideAfterExit([t0, t0 + 1, t0 + 2, t0 + 3], t0 + 3).action === "fallback");
check("old crashes age out of the 5 min window", decideAfterExit([t0, t0 + 1, t0 + 2, t0 + 6 * 60_000], t0 + 6 * 60_000).action === "restart");
check("backoff is capped at 30 s", (() => { const d = decideAfterExit([t0], t0, 99); return d.action === "restart" && d.delayMs <= 30_000; })());

// ---- supervisor, with fake children ------------------------------------------------
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bagicha-localmode-"));
const fake = path.join(dir, "fake-server.cjs");
fs.writeFileSync(fake, `
const http = require("http");
const mode = process.env.FAKE_MODE;
if (mode === "crash") process.exit(1);
const delay = mode === "slow" ? Number(process.env.FAKE_DELAY || 0) : 0;
setTimeout(() => {
  http.createServer((req, res) => {
    if (req.url === "/api/local/status") { res.setHeader("content-type","application/json"); const body = { localMode: mode === "notlocal" ? false : true };
      if (mode !== "nonce-missing") body.nonce = mode === "nonce-wrong" ? "0".repeat(32) : process.env.BAGICHA_LOCAL_NONCE;
      res.end(JSON.stringify(body)); }
    else { res.statusCode = 404; res.end("{}"); }
  }).listen(Number(process.env.PORT), "127.0.0.1");
}, delay);
if (mode === "die-after-ready") setTimeout(() => process.exit(2), delay + 600);
`);

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)); });
  });
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const mk = async (mode: string, extra: Record<string, string> = {}, opts: Partial<ConstructorParameters<typeof LocalServer>[0]> = {}) => {
  const port = await freePort();
  return { port, srv: new LocalServer({
    execPath: process.execPath, entry: fake, port, nonce: NONCE, stdio: "ignore", backoffScale: 0.01, log: () => {},
    env: { ...process.env, PORT: String(port), FAKE_MODE: mode, BAGICHA_LOCAL_NONCE: NONCE, ...extra }, ...opts,
  }) };
};

async function main() {
  {
    const { port, srv } = await mk("ok");
    const r = await srv.start();
    check("healthy child -> start() ok", r.ok === true && srv.isReady());
    check("probe accepts localMode:true with the right nonce", await probeLocalStatus(port, NONCE));
    check("probe rejects the same server for a different nonce", !(await probeLocalStatus(port, newLocalNonce())));
    srv.stop();
    await sleep(300);
    check("stop() frees the port", !(await probeLocalStatus(port, NONCE, 500)));
  }
  {
    const { port, srv } = await mk("notlocal", {}, { readyTimeoutMs: 800 });
    const r = await srv.start();
    check("localMode:false server -> start() not ok", r.ok === false);
    check("a server answering localMode:false is not ready", !(await probeLocalStatus(port, NONCE)));
    srv.stop();
  }
  for (const bad of ["nonce-missing", "nonce-wrong"]) {
    const { port, srv } = await mk(bad, {}, { readyTimeoutMs: 800 });
    const r = await srv.start();
    check(`server with ${bad} -> start() not ok, never ready`, r.ok === false && !srv.isReady() && !(await probeLocalStatus(port, NONCE)));
    srv.stop();
  }
  {
    const { srv } = await mk("crash");
    const t = Date.now();
    const r = await srv.start();
    check("child that always crashes -> falls back (not ok)", r.ok === false && /crashed/.test((r as any).reason), (r as any).reason);
    check("...well before the 45 s limit", Date.now() - t < 10_000, `${Date.now() - t} ms`);
    srv.stop();
  }
  {
    const { port, srv } = await mk("slow", { FAKE_DELAY: "2500" }, { readyTimeoutMs: 1000 });
    let later = false;
    srv.onReadyLater = () => { later = true; };
    const r = await srv.start();
    check("child slower than the limit -> start() reports not ready", r.ok === false && /not ready within/.test((r as any).reason), (r as any).reason);
    await sleep(2500);
    check("...but is kept warming up and reports ready later", later && (await probeLocalStatus(port, NONCE)));
    srv.stop();
  }
  {
    const { srv } = await mk("die-after-ready", { FAKE_DELAY: "0" }, { crashLimit: 1 });
    let gaveUp: string | null = null;
    srv.onGaveUp = (reason) => { gaveUp = reason; };
    const r = await srv.start();
    check("child that is ready then dies repeatedly: start() was ok", r.ok === true);
    for (let i = 0; i < 40 && !gaveUp; i++) await sleep(250);
    check("...then onGaveUp fires after the crash limit", gaveUp !== null, String(gaveUp));
    srv.stop();
  }
}

main()
  .catch((e) => { console.error(e); failures++; })
  .finally(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    if (failures) { console.error(`\n${failures} FAILED`); process.exit(1); }
    console.log("\nall local-mode config checks passed");
    process.exit(0);
  });
