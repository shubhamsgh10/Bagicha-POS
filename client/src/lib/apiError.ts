/**
 * Turn what `apiRequest` throws into something a person can read.
 *
 * `apiRequest` (lib/queryClient.ts) throws `new Error(\`${status}: ${rawBodyText}\`)` for any non-2xx
 * response, and the body is the server's JSON (`{"error": "..."}` or `{"message": "..."}`), so a raw
 * `error.message` reads like `403: {"message":"A manager or admin PIN is required…","code":"PIN_REQUIRED"}`.
 * POS.tsx, Billing.tsx and PaymentMethodDialog each hand-rolled this unwrapping; this is the one copy
 * new code should use.
 */
export interface ApiErrorInfo {
  /** The server's own explanation, or the raw message when the body wasn't JSON. */
  message: string;
  /** The HTTP status when the message carried one (e.g. 409 conflict, 403 PIN required). */
  status: number | null;
  /** The server's machine-readable `code` (e.g. "PIN_REQUIRED", "conflict", "short"), when present. */
  code: string | null;
}

export function describeApiError(err: unknown): ApiErrorInfo {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  const statusMatch = raw.match(/^(\d{3}):/);
  const status = statusMatch ? Number(statusMatch[1]) : null;
  const brace = raw.indexOf("{");
  if (brace !== -1) {
    try {
      const parsed = JSON.parse(raw.slice(brace));
      const message = parsed?.error || parsed?.message;
      if (message) return { message: String(message), status, code: parsed?.code ? String(parsed.code) : null };
    } catch {
      /* not JSON — fall through to the raw text */
    }
  }
  return { message: raw || "Something went wrong", status, code: null };
}
