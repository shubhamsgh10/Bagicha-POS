/**
 * Resolve the express-session secret.
 *
 * In production SESSION_SECRET is REQUIRED — falling back to a hardcoded string
 * would let anyone forge session cookies. We fail fast on boot instead. In
 * development a stable fallback keeps `npm run dev` friction-free.
 */
export function resolveSessionSecret(): string {
  const fromEnv = process.env.SESSION_SECRET?.trim();
  if (fromEnv) return fromEnv;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "SESSION_SECRET is required in production. Set it to a long random value " +
        "(e.g. `openssl rand -hex 32`) before starting the server.",
    );
  }

  return "bagicha-dev-secret-do-not-use-in-production";
}
