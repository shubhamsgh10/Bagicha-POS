// `_auth` for users / staff_members rows sent to the shop PC so it can verify logins and PINs
// offline. Computed in JS from the DB values, never SQL: the stripped columns stay out of the generic
// row JSON (rowJsonSql), so a code path that forgets this cannot leak a PIN.
//   pw  - users.password exactly as stored (a scrypt "salt:hash", already one-way)
//   pin - scrypt of the PIN with a FRESH random salt, "salt:hash". Never the plaintext.
import { hashPassword } from "../passwordHash";

export interface AuthBlob { pw?: string; pin?: string }
export interface AuthSource { id: number; password?: string | null; pin?: string | null }

export async function buildAuthBlob(src: { password?: string | null; pin?: string | null }): Promise<AuthBlob> {
  const blob: AuthBlob = {};
  if (src.password) blob.pw = src.password;
  if (src.pin) blob.pin = await hashPassword(String(src.pin));
  return blob;
}

/** Minimal runner so the same code runs on pg (cloud) and PGlite (tests). */
export interface QueryRunner { query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> }

/** Adds `_auth` to the already-built JSON rows of users / staff_members (other tables are returned as is). */
export async function attachAuth(runner: QueryRunner, table: string, rows: Array<Record<string, any>>): Promise<void> {
  if ((table !== "users" && table !== "staff_members") || rows.length === 0) return;
  const ids = rows.map((r) => Number(r.id)).filter((n) => Number.isInteger(n));
  const cols = table === "users" ? "id, password, pin" : "id, pin";
  const { rows: src } = await runner.query(`SELECT ${cols} FROM ${table} WHERE id = ANY($1::int[])`, [ids]);
  const byId = new Map<number, AuthSource>(src.map((s: any) => [Number(s.id), s]));
  await Promise.all(rows.map(async (r) => {
    const s = byId.get(Number(r.id));
    r._auth = s ? await buildAuthBlob(s) : {};
  }));
}
