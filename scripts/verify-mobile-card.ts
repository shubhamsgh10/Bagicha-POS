/**
 * Verifies mobile-card eligibility: a non-admin account with PIN + showOnMobile is card-eligible;
 * admin is excluded. Run: npx tsx -r dotenv/config scripts/verify-mobile-card.ts
 */
import { storage } from "../server/storage";
import { db } from "../server/db";
import { users } from "../shared/schema";
import { eq } from "drizzle-orm";

let uid: number | null = null;
try {
  const u = await storage.createUser({ username: "zz_card_mgr", password: "x", role: "manager", pin: "1234", showOnMobile: true } as any);
  uid = u.id;

  // Mirror the /api/staff-members card filter.
  const all = await storage.getUsers();
  const cards = all.filter(x => x.pin && x.showOnMobile && x.role !== "admin").map(x => ({ kind: "user", id: x.id, name: x.username }));
  const mgrCard = cards.find(c => c.id === u.id);
  console.log("manager card:", mgrCard);

  const adminUser = await storage.getUserByUsername("admin");
  const adminCard = adminUser ? cards.find(c => c.id === adminUser.id) : undefined;
  console.log("admin card (must be undefined):", adminCard);

  // Mirror card-login checks for a user.
  const fetched = await storage.getUser(u.id);
  const loginOk = fetched?.pin === "1234" && !!fetched?.showOnMobile && fetched?.role !== "admin";

  const ok = !!mgrCard && !adminCard && loginOk;
  console.log(ok ? "\nRESULT: PASS ✅" : "\nRESULT: FAIL ❌");
} catch (e: any) {
  console.error("ERROR:", e.message);
  process.exitCode = 1;
} finally {
  if (uid != null) await db.delete(users).where(eq(users.id, uid));
  console.log("cleaned up");
  process.exit(process.exitCode ?? 0);
}
