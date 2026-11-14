// express-session store on the local PGlite database (table local_sessions), so a sign-in on the
// shop PC survives a local-server restart. Cloud login cookies (req.session.cloudCookies) live in
// the same session JSON.
import session from "express-session";
import type { PGlite } from "@electric-sql/pglite";

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

function expiryOf(sess: session.SessionData): Date {
  const exp = sess?.cookie?.expires;
  if (exp) return new Date(exp);
  const maxAge = sess?.cookie?.maxAge;
  return new Date(Date.now() + (typeof maxAge === "number" ? maxAge : DEFAULT_TTL_MS));
}

export class PgliteSessionStore extends session.Store {
  private lastPrune = 0;

  constructor(private readonly client: PGlite) {
    super();
  }

  private prune() {
    const now = Date.now();
    if (now - this.lastPrune < 10 * 60 * 1000) return;
    this.lastPrune = now;
    this.client.query(`DELETE FROM local_sessions WHERE expire < now()`).catch(() => {});
  }

  get(sid: string, cb: (err: any, sess?: session.SessionData | null) => void): void {
    this.client
      .query<{ sess: session.SessionData }>(`SELECT sess FROM local_sessions WHERE sid = $1 AND expire > now()`, [sid])
      .then((r) => { this.prune(); cb(null, r.rows.length ? r.rows[0].sess : null); })
      .catch((e) => cb(e));
  }

  set(sid: string, sess: session.SessionData, cb?: (err?: any) => void): void {
    this.client
      .query(
        `INSERT INTO local_sessions (sid, sess, expire) VALUES ($1, $2::jsonb, $3)
         ON CONFLICT (sid) DO UPDATE SET sess = EXCLUDED.sess, expire = EXCLUDED.expire`,
        [sid, JSON.stringify(sess), expiryOf(sess).toISOString()],
      )
      .then(() => cb?.())
      .catch((e) => cb?.(e));
  }

  destroy(sid: string, cb?: (err?: any) => void): void {
    this.client
      .query(`DELETE FROM local_sessions WHERE sid = $1`, [sid])
      .then(() => cb?.())
      .catch((e) => cb?.(e));
  }

  touch(sid: string, sess: session.SessionData, cb?: () => void): void {
    this.client
      .query(`UPDATE local_sessions SET expire = $2 WHERE sid = $1`, [sid, expiryOf(sess).toISOString()])
      .then(() => cb?.())
      .catch(() => cb?.());
  }
}
