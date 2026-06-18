/**
 * Per-person / per-role PAGE ACCESS (visibility) — shared by client + server.
 *
 * This is page VISIBILITY only (which nav pages a staff-tier person can open). It does NOT touch
 * login, PINs, or the permission/role engine. "My Attendance" is always visible (alwaysVisible in
 * TopNav) and is never stored here.
 */

/** Pages whose visibility can be configured per staff person. */
export const STAFF_PAGES: { label: string; href: string }[] = [
  { label: "Tables",      href: "/tables" },
  { label: "Orders",      href: "/orders" },
  { label: "Billing",     href: "/billing" },
  { label: "KOT",         href: "/kot" },
  { label: "Staff",       href: "/staff" },
  { label: "Menu",        href: "/menu" },
  { label: "Inventory",   href: "/inventory" },
  { label: "Live Tables", href: "/live-tables" },
  { label: "Customers",   href: "/customers" },
];

export const STAFF_PAGE_HREFS = STAFF_PAGES.map(p => p.href);

/** Job roles assignable to a staff member at creation (Manager is the separate account tier). */
export const STAFF_ROLE_OPTIONS = ["Service", "Cook", "Cleaning", "Cashier", "Other"];

/** Default pages seeded by role (keyed lowercase). My Attendance is always allowed and never listed. */
export const ROLE_PAGE_DEFAULTS: Record<string, string[]> = {
  service:  ["/tables", "/orders", "/billing"],
  cook:     ["/kot"],
  cashier:  ["/billing", "/orders"],
  cleaning: [],
  staff:    [],
  other:    [],
};

/** A staff-tier person's key in the `staffPageAccess` map. */
export function personPageKey(kind: "user" | "staff", id: number): string {
  return `${kind === "staff" ? "sm" : "u"}:${id}`;
}

/**
 * Resolve which pages a staff-tier person may see:
 *   explicit per-person override  →  role default seed  →  none (only My Attendance).
 */
export function resolveStaffAllowedPages(
  key: string,
  role: string | null | undefined,
  map: Record<string, string[]> | null | undefined,
): string[] {
  const override = map?.[key];
  if (override) return override;
  return ROLE_PAGE_DEFAULTS[(role ?? "").toLowerCase()] ?? [];
}
