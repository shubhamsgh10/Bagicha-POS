/** True when an If-None-Match request header matches `etag` (comma-separated list, or "*"). Pure. */
export function ifNoneMatchHits(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  if (header.trim() === "*") return true;
  return header.split(",").some((tag) => tag.trim() === etag);
}
