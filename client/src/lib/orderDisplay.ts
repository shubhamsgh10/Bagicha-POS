/** Returns a short human-readable serial like "#042" from an order's DB id. */
export const serialNum = (id: number): string =>
  "#" + String(id).padStart(3, "0");

/** Avatar digits — last 2 chars of the id, e.g. 42 → "42", 1042 → "42" */
export const avatarNum = (id: number): string =>
  String(id).slice(-2).padStart(2, "0");
