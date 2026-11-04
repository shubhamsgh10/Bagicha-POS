# Full-app review — grouped fix list

Scope: all 59,985 lines of the app (248 files; `components/ui/` shadcn kit and `scripts/` excluded),
in 18 slices (`slices.json`). Each slice had one reviewer and one independent checker told to refute
by default. **207 findings reviewed → 194 confirmed, 13 refuted.** By checked severity: 2 critical,
26 high, 65 medium, 101 low. Every confirmed finding, with its failure scenario, is in
`ALL-FINDINGS.md`; raw files are `R*.findings.json` / `R*.verified.json`.

Many findings are the same root cause seen from different files. They are grouped below into fixes.
Items marked ✔ were also re-read in the code by the coordinator, not only by the checker.

## Urgent — security, money, data loss

| # | Fix | Findings | Why urgent |
|---|-----|----------|-----------|
| U1 ✔ | **Stop sending PINs / password hashes / 2FA secrets to the browser.** `getAttendance`, `getLeaves`, `getStaffProfiles` attach full `users`/`staff_members` rows; `GET /api/users` strips the PIN but not `totpSecret`. Strip with `sanitizeUser` / select only display fields. | R13, R16 (critical), R12, R16 | Any staff PIN session reads every manager's PIN, then types it into verify-pin → manager elevation (cancel, write-off, discount). |
| U2 | **Order status can only move forward through the gated flows.** `PUT /api/orders/:id` accepts `status:"cancelled"` and un-cancels; Order History's dropdown uses it. `PUT /api/kot/:id` flips a cancelled order back to ready. `POST /api/orders` takes `status` from the client. Cancel doesn't refuse a paid order. | R07, R13, R16, R12 | Cancel with no PIN/reason/audit, un-cancel into sales, hide a due. |
| U3 ✔ | **Settings saves must never write the bill/KOT counters.** Settings page and Print Settings PUT the whole stale blob; `saveSettings` merges it. Strip `billCounter`/`kotCounter` server-side. | R02, R09, R12, R15 | Order/KOT numbers roll back → duplicate-number 500s on order creation. |
| U4 | **Menu / category / table / inventory writes need manager+**, and menu prices must be validated (positive numbers). | R12, R17 | A staff PIN session can set any price — the pricing floor trusts the menu. |
| U5 ✔ | **Customers-page sync wipes data.** Client sends `dateOfBirth`, server reads `dob` → birthdays/anniversaries nulled; stale localStorage `doNotSendUpdate` overwrites a STOP opt-out. | R04, R06, R14 | Silent data loss on every Customers-page open; messages to customers who opted out. |
| U6 | **WhatsApp send safety.** Rule engine + settlement fallback send via the driver directly (skip opt-out + `maxPerDay`); lapsed/milestone rules re-fire daily; `POST /api/crm/automation/run` is any-session, `force:true`, unbounded `limit`. | R13, R14 | Ban risk on the restaurant's number; messages to opted-out customers. |
| U7 | **No auto-created `admin/admin123`.** Boot recreates it whenever no user is literally named `admin` (rename/delete the real admin → backdoor). | R12 | Known-password admin on production. |
| U8 | **2FA routes need `requireUserAccount`** (staff-member session reads/writes the colliding `users` row). | R12 | Same id-collision IDOR class as the fixed profile route. |
| U9 | **Remove/guard destructive one-tap DB tools.** "Sync Schema" runs `drizzle-kit push --force` (would offer to drop `sessions`, labelled non-destructive); "Reset Bill Number" sets the counter to 0; `npm run seed` hard-deletes menu/categories/inventory on the shared DB. | R09, R12, R13 | One tap can drop tables or break order creation. |
| U10 | **Billing "Collect Payment" on an old due** goes through the POS payment route: frees a table now used by another party, re-fires loyalty/WhatsApp, no PIN, no audit. Route dues to `settle-due`. | R06, R13 | Wrong table freed during service; unaudited money path. |
| U11 | **POS duplicate order:** settling a never-saved cart whose payment then fails leaves no `activeOrderId`, so the retry creates a second order (second KOT, double stock). | R08 | Duplicate kitchen tickets + stock. |
| U12 | **POS pickup/delivery serviceMode drift:** lines added after the first save stay `dinein` in the cart while the server stores `pickup`; removal skips the cancel-reason dialog and later saves 400. | R08 | Order becomes unsavable mid-service. |
| U13 | **Editing a sized menu item outside "Woodfire Pizza" wipes its sizes.** | R01 | Silent menu data loss; size prices revert to base. |
| U14 | **Merge into itself deletes the order**; merge drops the source discount; merge/move don't check status. | R13 | Order loss / overcharge. |
| U15 | **RealtimeProvider keeps one `lastMessage` slot** — events arriving in the same render (incl. `PRINT_JOB`) are dropped. | R04 | Missed live updates / delayed prints. |

## Can wait — correctness, latency, cleanup

About 60 medium and 100 low findings. Main themes (details in `ALL-FINDINGS.md`):

- **Timezone:** remaining UTC/browser-local "today" (attendance today, roster week, report defaults, KOT preview times, quiet hours on the client).
- **Fire-and-forget on Vercel:** loyalty/WhatsApp/feedback after settle; print on table-move after `res.json`.
- **Latency/egress:** N+1 in `GET /api/orders/:id`, serial dashboard queries, per-card Intelligence requests, oversized `NEW_ORDER` broadcast.
- **Print pipeline:** fast-path timeout can double-print, raw bytes to the first installed printer when no queue matches, dedup key edge cases, dangling printer ids.
- **Admin/CRM UX:** masked secrets concatenated on save, relative URLs in Growth panel, offline badge never clears, swallowed save errors.
- **Payroll print XSS** via a self-renamed account name (medium).
- **Backups** omit `restaurant_settings` and HR/print/conversation tables.

## Not judged

Razorpay (Billing) — out of scope per CLAUDE.md; one finding is recorded for awareness only.
