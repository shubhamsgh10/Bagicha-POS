/**
 * Marks one order's pending print_jobs as printed. Use right after a manual KOT/Bill tap on a
 * throwaway order so the restaurant host's catch-up poll can never pick the job up.
 * Run: npx tsx scripts/dev-quiet-print-jobs.ts <orderId>
 */
import "dotenv/config";
import { pool } from "../server/db";

const orderId = Number(process.argv[2]);
if (!orderId) {
  console.error("usage: tsx scripts/dev-quiet-print-jobs.ts <orderId>");
  process.exit(2);
}
const r = await pool.query(
  "UPDATE print_jobs SET status = 'printed', printed_at = now() WHERE order_id = $1 AND status = 'pending' RETURNING id",
  [orderId],
);
console.log(`marked ${r.rowCount} job(s) printed for order ${orderId}`);
await pool.end();
