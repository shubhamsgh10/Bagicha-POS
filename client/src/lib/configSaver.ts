import { apiUrl } from "@/lib/api";

/**
 * Saves partial config patches to a POST endpoint without the per-keystroke races: patches made
 * within `delayMs` are merged into ONE request, requests go out strictly one after another (two
 * concurrent POSTs could land in either order, leaving an older value saved), and a non-2xx is
 * reported instead of being treated as saved.
 */
export function createPatchSaver(
  path: string,
  onError: (message: string) => void,
  delayMs = 600,
): (patch: Record<string, unknown>) => void {
  let pending: Record<string, unknown> = {};
  let timer: ReturnType<typeof setTimeout> | null = null;
  let chain: Promise<void> = Promise.resolve();

  const flush = () => {
    timer = null;
    const body = pending;
    pending = {};
    chain = chain.then(async () => {
      try {
        const res = await fetch(apiUrl(path), {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) onError(`The change wasn't saved (${res.status}).`);
      } catch {
        onError("The change didn't reach the server.");
      }
    });
  };

  return (patch) => {
    pending = { ...pending, ...patch };
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, delayMs);
  };
}
