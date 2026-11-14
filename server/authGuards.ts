// Session/role guards shared by routes.ts and the route modules it registers (staffRoutes.ts, ...).
// Kept in their own module with no imports: staffRoutes.ts used to import them from ./routes while
// routes.ts imports staffRoutes. Once server/db.ts gained a top-level await (PGlite), that cycle
// deadlocked esbuild's bundled server — dist/index.js exited 13 ("unsettled top-level await")
// before listening, in every mode (npm start, the Electron host build and shop-PC local mode).
// Route modules must import these from here, never from ./routes.

export function requireAuth(req: any, res: any, next: any) {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ message: "Unauthorized" });
}

export function requireAdmin(req: any, res: any, next: any) {
  if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
  if (req.user?.role !== "admin") return res.status(403).json({ message: "Admin access required" });
  next();
}

// Manager OR admin — gates staff/payroll data so staff-tier (PIN) sessions can't read salaries/roster.
export function requireManagerOrAdmin(req: any, res: any, next: any) {
  if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
  if (req.user?.role !== "admin" && req.user?.role !== "manager") return res.status(403).json({ message: "Manager access required" });
  next();
}
