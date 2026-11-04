# All confirmed findings (generated from docs/review/R*.verified.json)

194 confirmed. Ranked by checked severity. See REPORT.md for the grouped, de-duplicated fix list.


## Critical

- **GET /api/attendance and GET /api/leaves (requireAuth) return full users/staffMembers rows incl. plaintext PINs, password hash and totpSecret** — `server/routes.ts:4164` (R13)  
  A staff-tier PIN session calls GET /api/leaves or GET /api/attendance (no filters). The JSON contains every manager's `user.pin` in plaintext. The staff member replays it to POST /api/auth/verify-pin {requiredRole:'manager'}, gets a 90s elevation grant (and requireFreshPin approval), and can cancel orders, write off bills, settle dues, apply discounts — exactly the escalation chain CLAUDE.md documents for the old /api/auth/profile leak.

- **getAttendance and getLeaves embed full users/staffMembers rows (plaintext PIN, password hash, totpSecret) and are returned by requireAuth endpoints** — `server/storage.ts:1781` (R16)  
  A bare staff-tier PIN session calls GET /api/attendance (no filters) or GET /api/attendance/today. The response lists every person with an attendance row; each `user` object for a manager account includes `pin: "4321"` and `totpSecret`. The staff member replays that PIN to POST /api/auth/verify-pin and gets a manager elevation grant: discounts, write-offs, cancels, payment-method edits and due settles all open up. The same leak happens through GET /api/leaves.


## High

- **Editing any sized item outside the 'Woodfire Pizza' category wipes its sizes** — `client/src/components/AddMenuItemModal.tsx:233` (R01)  
  Admin opens 'Cold Coffee' (sizes Regular ₹120 / Large ₹160, category Beverages) in the Menu page to fix a typo in its description and clicks Update. sizes becomes NULL; POS now sells it only at the base price with no size picker, and historical size-price floors are gone. Same for a pizza that had a non-Small/Medium/Large size.

- **Saving Print Settings writes back a stale billCounter/kotCounter (and every other setting) from the Settings page snapshot** — `client/src/components/PrintSettingsPanel.tsx:925` (R02)  
  Admin opens Settings at 19:00 (billCounter=400, kotCounter=900). Service continues, 25 orders are created (billCounter=425). At 19:40 the admin opens Print Settings, flips a toggle and saves: billCounter goes back to 400. The next POS save issues ORD0401, which already exists -> orders.order_number UNIQUE violation -> POST /api/orders returns 500 'failed' for each of the next ~25 orders (each failure burns one number) until the counter passes the real max; kotNumber collides the same way on item edits. Staff see 'order failed' repeatedly mid-service. syncCounterFromMax only repairs at cold start.

- **Single-slot lastMessage drops realtime events that arrive before React re-renders, including PRINT_JOB** — `client/src/hooks/RealtimeProvider.tsx:50` (R04)  
  A phone on Vercel taps KOT for a mixed order routed to two printers. Both PRINT_JOB events land back-to-back, and the desktop host's effect sees only the second, so the first printer's ticket stays 'pending' until the host's realtime connection next reconnects or the app restarts. The kitchen never gets that KOT. The same loss hits ORDER_UPDATE for useLiveTableOperations / useLiveOrders (stale cards) and WA_MESSAGE for the inbox.

- **Background extras sync wipes every customer's DB birthday/anniversary and can undo WhatsApp opt-outs** — `client/src/hooks/useCrmProfile.ts:194` (R04)  
  An admin opens Customers once isLoading is false. 3 s later every customer that has a localStorage extras entry gets dob=NULL and anniversary=NULL in customer_profiles, so birthdayService stops matching them and birthday coupons/messages stop. A customer who replied STOP on WhatsApp (DB doNotSendUpdate=true), but whose localStorage entry on this browser still says false, is opted back in and gets automated messages again.

- **Billing's 'Collect Payment' settles old Pay-Later dues through the POS payment route: frees a re-used table, re-fires loyalty/WhatsApp, skips the settle-due PIN and audit** — `client/src/pages/Billing.tsx:583` (R06)  
  Table 5's party took a due on Monday (table freed). Wednesday table 5 is occupied by a new running order. A cashier clears Monday's due from Billing -> table 5 is flipped to 'free' while the new party is still seated (Tables page shows it free, can be double-seated), and Monday's customer gets a second 'thank you' message and loyalty points.

- **Background extras sync wipes every synced customer's DOB/anniversary (dateOfBirth vs dob key mismatch)** — `client/src/pages/CustomerDashboard.tsx:1063` (R06)  
  Staff edits a customer and sets DOB 12 Mar (profile POST stores dob). Next time anyone opens Customers on that device, the 3s-debounced bulk sync upserts the same customer with dob=null. birthdayService/automationRuleEngine read customerProfiles.dob, so the birthday message never fires.

- **Stale per-device localStorage is bulk-written over the DB profile on every mount, reversing WhatsApp STOP opt-outs** — `client/src/pages/CustomerDashboard.tsx:1063` (R06)  
  Customer texts STOP; inboundService sets customer_profiles.do_not_send_update=true. A staff phone that once toggled/edited that customer (local entry with doNotSendUpdate:false) opens Customers; the bulk sync writes doNotSendUpdate=false and the automation engine resumes sending to an opted-out number (ban/compliance risk). Same path un-mutes a customer muted from another device.

- **Status dropdown un-cancels a cancelled order (and can hide/resurrect dues) with no PIN** — `client/src/pages/Orders.tsx:229` (R07)  
  A staff-tier session opens Order History, finds a cancelled order (status cancelled, paymentStatus pending) and picks 'served'. The order becomes served+pending, i.e. a Due (isDueOrder), reappears in the Pay-Later/dues totals and the Tables Due pill, and no longer counts as cancelled in reports — without a PIN or audit row, and with stock already reversed. Conversely picking 'pending' on a served+unpaid due drops it out of every Due list (isDueOrder requires served), hiding a customer's debt; picking 'pending' on a paid order puts it back into ACTIVE_ORDER_STATUSES on Live View.

- **Settling a never-saved cart creates the order but never records activeOrderId; a failed payment then makes the retry create a second order** — `client/src/pages/POS.tsx:997` (R08)  
  New table order (from Tables, ?tableId=5), staff tap Settle → Cash. POST /api/orders commits (order #A, kot_tickets row on the Kitchen screen, stock deducted, table running) but POST /api/orders/A/payment fails (network stall/abort, a 503 'settings unavailable', a 403 because the write-off PIN grant expired). Staff tap Settle again: activeOrderId is still null, so a SECOND POST /api/orders creates order #B with the same items — a duplicate kitchen ticket, double inventory deduction — and #B is settled while #A stays open/unpaid on the same table (it appears as a pending/backlog order).

- **Standalone pickup/delivery: lines added after the first save keep serviceMode 'dinein' in the cart while the server stores 'pickup'/'delivery', so removing them skips the cancel-reason dialog and every later save is rejected with 400** — `client/src/pages/POS.tsx:1387` (R08)  
  Open a pickup order (/pos?orderId=X&mode=pickup, loaded lines are 'pickup'), add Roti (cart says 'dinein'), tap KOT → saved as Roti/pickup and visible to the kitchen. Customer drops the Roti: tapping × finds wasItemKotd(Roti)=false (dinein ≠ pickup), so it is removed under the plain removeItem gate with no reason. The next KOT/Bill/Save/Settle PUT drops Roti:pickup with no matching reason → 400 'reason required'; every later save (and the Auto-KOT sync) keeps failing until staff leave and reopen the order. Even via the reason dialog the stashed key would be Roti::dinein and still not match.

- **Saving Restaurant Configuration PUTs the whole stale settings blob, rolling back billCounter/kotCounter and other settings** — `client/src/pages/Settings.tsx:923` (R09)  
  Admin opens Settings at 19:00 (billCounter=400), orders keep flowing on the POS (billCounter now 412), admin fixes the footer note and taps Save at 19:20. billCounter is written back to 400, so the next 12 POST /api/orders allocate ORD0401..ORD0412, which already exist -> UNIQUE violation -> 500 on real order saves during service until the counter passes the max. kotCounter rolls back too (duplicate KOT numbers in the kitchen). Any print-settings/permissions change saved by another device in the meantime is also silently reverted.

- **'Sync Schema' is a one-tap `drizzle-kit push --force` labelled 'Safe and non-destructive — no data is deleted'** — `client/src/pages/Settings.tsx:1104` (R09)  
  On the persistent/Electron-host server (where npx drizzle-kit is available) an admin taps Sync Schema after an update; if schema.ts lags any hand-applied column (or a branch with an older schema is deployed), --force drops that column and its data from the one shared production DB with no prompt.

- **Boot re-creates a default admin/admin123 account whenever no user is literally named 'admin'** — `server/routes.ts:384` (R12)  
  Owner renames the 'admin' account to their own name in Profile (a normal hardening step). The next cold start silently creates a fresh admin/admin123 account — publicly known credentials (they are in the source) with full owner rights: payroll, settings, clear-orders, user management.

- **2FA setup/verify/disable/status key on req.user.id without requireUserAccount — staff-member session writes a users row** — `server/routes.ts:504` (R12)  
  Staff member id 1 logs in by PIN card, POSTs /api/auth/2fa/setup (gets a secret it controls), then /verify-setup with a code from it. The UPDATE sets totp_secret/totp_enabled on users.id = 1 (typically the owner/admin). The admin's next password login now demands a TOTP code only the staff member has — admin locked out — and the attacker holds a valid second factor for that account. /2fa/status likewise reports another user's 2FA state.

- **GET /api/users (requireAuth) returns every user's totpSecret to any session, incl. staff PIN sessions** — `server/routes.ts:927` (R12)  
  A staff-tier card-login session calls GET /api/users and receives the admin's base32 TOTP secret. Anyone who also learns the admin password (shoulder-surfed, reused) can now generate valid 2FA codes, defeating 2FA entirely.

- **PUT /api/settings persists the client's stale billCounter/kotCounter, rolling the order/KOT numbers back** — `server/routes.ts:1326` (R12)  
  Admin opens Settings at 7pm (billCounter=400), 30 orders are placed during service, admin edits the footer note and saves at 9pm: billCounter is written back to 400. The next POST /api/orders issues ORD0401, which already exists (order_number is UNIQUE) → 500 'Failed to create order'; each retry burns one number, so staff see ~30 consecutive failed orders (same for kot_number). On a persistent server nothing repairs it until restart.

- **Menu, category, table and inventory writes are requireAuth only — a staff PIN session can change prices** — `server/routes.ts:1687` (R12)  
  A staff card-login session (or anyone with a staff PIN) sends PUT /api/menu/12 {price:'1', sizes:[...1...]} for a ₹450 dish, rings orders at ₹1, pockets the difference, then restores the price — the server-recomputed bills are 'correct' against the tampered floor and no audit row exists. Equally, bulk-delete can soft-delete the whole menu mid-service.

- **PUT /api/orders/:id lets any session set status to 'cancelled' (or un-cancel / reopen a paid order) with no elevation, reason, audit or side effects** — `server/routes.ts:2577` (R13)  
  (a) A staff session (or curl with its cookie) sends PUT /api/orders/123 {status:'cancelled'} on a paid order: it disappears from Total Sales/Top Items with no manager PIN and no audit row, while the cash stays in the drawer. (b) On Order History a staff member picks 'pending' on a cancelled order: it re-enters sales (status <> 'cancelled') and Live View's active orders, stock is not re-deducted, nothing is audited.

- **POST /api/crm/automation/run is requireAuth, defaults to force:true and takes an unbounded client `limit` — any staff session can fire a real outbound WhatsApp/SMS batch** — `server/routes.ts:4067` (R13)  
  A staff PIN session POSTs /api/crm/automation/run {limit:10000}: the server sends win-back/at-risk messages to every eligible customer even though the owner left automation disabled, risking a WhatsApp number ban and spamming customers.

- **`npm run seed` hard-deletes menu_items, categories and inventory on the one shared production DB, with no guard or transaction** — `server/seed.ts:8` (R13)  
  A developer follows the Commands section and runs `npm run seed`: the live restaurant menu, categories and stock are wiped and replaced with 22 demo dishes; every historical KOT/bill reprint of a menu item now prints 'Item', category revenue collapses to 'Uncategorized', and stock_movements reference missing inventory (or the inventory delete fails midway, leaving a half-seeded DB since nothing is transactional).

- **Lapsed / high-spend / milestone rules re-fire every day forever for the same customers** — `server/services/crm/automationRuleEngine.ts:192` (R14)  
  A customer last visited 40 days ago. With automation enabled, every day at 10am the rule engine sends them a win-back offer, and the hourly engine queues WIN_BACK again each new day. A ₹10k+ lifetime customer gets 'complimentary starter' every day. This continues until they return, which is exactly the send volume CLAUDE.md warns gets numbers banned.

- **Rule engine and settlement fallback send through the WhatsApp driver directly, bypassing the outbound queue's opt-out check and maxPerDay cap** — `server/services/crm/automationRuleEngine.ts:384` (R14)  
  A customer replied STOP (conversations.optedOut=true) and the Baileys host is connected with whatsappAutoSend=false. At their next settlement, triggerSettlementMessage → dispatchSettlement → sendMessage → driver.sendText sends a THANK_YOU anyway. The 10am rule-engine run sends up to 50 direct messages that are not counted toward maxPerDay.

- **Customers-page background sync overwrites DB profiles, including a WhatsApp STOP opt-out, with stale localStorage values** — `server/services/crm/customerIdService.ts:196` (R14)  
  A customer replies STOP, so doNotSendUpdate=true in the DB. Later the owner opens Customers on the desktop, whose localStorage still has that customer's extras with doNotSendUpdate:false. Three seconds later the flag is false again. buildSnapshots (the daily rule engine, which reads only customer_profiles and sends directly through the driver) messages them again. A DOB edited on a phone is likewise reverted by the desktop's old copy.

- **saveSettings blindly merges client-sent billCounter/kotCounter (and every other stale field), rolling the bill/KOT counters backward** — `server/settingsStore.ts:433` (R15)  
  Admin opens Admin > Print Settings at 13:00 when billCounter=50, kotCounter=120. Service continues; by 14:00 billCounter=70, kotCounter=160. Admin toggles a printer option and saves. saveSettings writes billCounter=50, kotCounter=120. The next 20 order creations issue ORD0051..ORD0070, each hitting the orders.order_number UNIQUE constraint and failing with a 500 (and KOT numbers collide on kot_tickets.kot_number UNIQUE) until the counter passes the real max — staff see 'failed to save order' repeatedly mid-service.

- **getStaffProfiles returns full user rows (including admins' plaintext PIN and totpSecret) to manager sessions via GET /api/staff** — `server/storage.ts:1738` (R16)  
  The everyday manager login (rajbhaghel) opens the Staff page, or calls GET /api/staff directly. The JSON includes the owner's `pin` and `totpSecret`. With those, the manager can satisfy admin-PIN prompts (the client asks for the admin PIN on manager-mode write-offs and other gated actions) and can generate the owner's 2FA codes. The owner's account security now rests on the password hash alone.

- **PUT /api/orders/:id lets any session set status to "cancelled" (or un-cancel), bypassing the PIN-gated, audited cancel flow** — `shared/orderMutation.ts:198` (R16)  
  A staff PIN session settles a ₹1,200 cash order, pockets the cash, then sends PUT /api/orders/<id> {"status":"cancelled"} (one fetch from devtools or curl with the session cookie and Content-Type: application/json, which passes the CSRF guard). Every sales aggregate (Live View, Reports Total Sales, sales-by-type, top items, staff tables) excludes cancelled orders, so the ₹1,200 disappears from the day's takings with no cancel reason, no PIN, no audit row and nothing in KOT & Bill Activity.


## Medium

- **Short Code, Vegetarian, Spicy and Allergens fields are never saved** — `client/src/components/AddMenuItemModal.tsx:340` (R01)  
  Admin sets Short Code 'HPP' on Paneer Pizza and saves; the toast says updated, but reopening shows an empty Short Code and typing HPP + Enter in the POS short-code box adds nothing.

- **Audit log fetch omits credentials, so it 401s from the Electron thin client** — `client/src/components/AuditLogPanel.tsx:90` (R01)  
  Owner opens Settings → Audit Log on the shop desktop app: the query throws 'Failed to fetch audit logs' every 30 s and no entries ever appear, though it works in a browser on the Vercel origin.

- **If the initial config GET fails, the next toggle POSTs DEFAULT_GC and wipes the saved server config** — `client/src/components/AutomationPanel.tsx:342` (R01)  
  Admin opens Customers → Automation while the network blips (GET returns 5xx or times out). The Rules tab shows everything off; admin flips 'Ask for Feedback' on. The server config now has no Meta/WATI credentials, no owner phone and default templates; automated messages and the daily digest stop.

- **Masked secret fields hold the literal '***configured***' as their value, so typing a new secret appends to it and saves a corrupted key** — `client/src/components/GrowthSettingsPanel.tsx:168` (R02)  
  Admin rotates the Razorpay key secret: clicks the Key Secret box, pastes the new secret, Save. Stored secret becomes '***configured***abc123…'; every Razorpay order/verification call fails with an auth error until someone clears the field fully and re-enters it.

- **'Send digest now', 'Send pending feedback now' and 'Run birthday scan' fetch relative URLs instead of apiUrl()** — `client/src/components/GrowthSettingsPanel.tsx:225` (R02)  
  Owner on the desktop app opens Settings -> Growth and taps 'Send now' for the digest: fetch('file:///api/digest/run') fails (or res.json() throws on a non-JSON 404 page on a separate UI host), toast says 'Send digest now failed', while 'Preview' on the same card works. The birthday scan and pending-feedback buttons never work there either.

- **Removing a printer leaves kotPrinterId / billPrinterId / category routes / section bill printers pointing at the deleted id** — `client/src/components/PrintSettingsPanel.tsx:421` (R02)  
  Kitchen printer's IP changes after a router swap; admin deletes the old 'Kitchen' printer, adds a new one with the new IP and saves without revisiting the KOT tab. Every KOT tap now opens a browser print window instead of reaching the kitchen printer, and Auto-KOT prints nothing at all, until someone notices the KOT Printer dropdown reads '— None —'.

- **Upward role switch skips the PIN whenever no user OF THAT EXACT ROLE has a PIN, even though higher-role PINs would be accepted** — `client/src/components/RoleSwitcher.tsx:86` (R02)  
  Restaurant has admin 'owner' (PIN set) and manager 'rajbhaghel' (no PIN). A staff-card session opens POS, taps the role switcher, picks Manager: it switches instantly, no PIN. The staff member can now add arbitrary-priced Open Items and perform any other manager-tier client-only action that would otherwise have required a manager PIN.

- **Reply draft carries over when switching WhatsApp threads, so a message meant for one customer can be sent to another** — `client/src/components/conversations/ConversationsView.tsx:83` (R03)  
  Agent types 'Your order #123 refund is processed' into customer A's thread, clicks customer B in the thread list to check something, comes back to the box (now showing B's chat) and presses Enter: the text is sent to customer B over WhatsApp. Also, a reply still pending for A clears B's draft on success.

- **Loyalty 'Redeem' only writes localStorage and shows 'Applied!' — no discount is applied anywhere and points diverge from the server ledger** — `client/src/components/loyalty/LoyaltyCard.tsx:18` (R03)  
  Manager on Customers page taps Redeem for a customer, sees 'Applied!' and tells the customer ₹10 is off; the bill is unchanged. On another device/browser the same points still show as available, and the server ledger balance shown elsewhere disagrees with this card.

- **Private-channel subscription failure is never detected or retried; status still shows Open** — `client/src/hooks/RealtimeProvider.tsx:140` (R04)  
  The desktop host's /api/pusher/auth call hits a 503 at startup. The app looks live, but no PRINT_JOB, ORDER_UPDATE or TABLE_UPDATE events ever arrive. Remote prints from phones queue up as pending until someone restarts the app.

- **Run Now / saving settings in API/Meta mode silently re-enables the server's scheduled WhatsApp automation and overwrites its maxPerRun** — `client/src/lib/automationEngine.ts:469` (R05)  
  Admin has turned the server automation off (or set maxPerRun to 5 for a freshly warmed number) via the server-backed setup UI. Later they press Run Now once in API mode on a browser whose localStorage still has the defaults. The server config flips to enabled:true, maxPerRun:20, and the scheduler starts sending lapsed-customer WhatsApp batches every interval with nobody having asked for it — the ban-risk send volume CLAUDE.md warns about.

- **Coupon and loyalty redeem from Billing always 403 for staff sessions - no PIN path exists** — `client/src/pages/Billing.tsx:246` (R06)  
  Cashier (staff PIN login) types the customer's birthday coupon and taps Apply -> validate succeeds, apply returns 403, message shows a JSON blob; the customer is charged full price or staff go find a manager to log in.

- **Intelligence grid fires one /api/crm/customers/:key request per customer card** — `client/src/pages/CustomerDashboard.tsx:614` (R06)  
  With ~500 customers, opening Intelligence sends ~500 requests (serverless instances + Supabase egress), saturating the browser's connection pool so other API calls on the page (conversations, feedback) queue for seconds.

- **Saving any customer that has a phone back-fills that phone into every phone-less order with the same NAME (other people)** — `client/src/pages/CustomerDashboard.tsx:1070` (R06)  
  Customer 'Rahul' (phone 98xxxx) is edited to add an email. Every phone-less historical order named 'Rahul' (other walk-ins) now carries 98xxxx: their visits/spend merge into this Rahul, loyalty/VIP segmentation and WhatsApp due reminders go to the wrong person.

- **Mute/Unmute toggle on an existing customer never reaches the DB in this session** — `client/src/pages/CustomerDashboard.tsx:1095` (R06)  
  Staff mute a regular who complained; the button shows Muted, but the daily lapsed-customer/birthday engine still messages them until someone reopens the Customers page on that device.

- **Edit Customer modal is seeded from this device's localStorage, so Save blanks fields stored in the DB** — `client/src/pages/CustomerDashboard.tsx:1178` (R06)  
  Manager enters email+address for a customer on the counter PC. A waiter edits the same customer's locality on a phone (no local entry): form starts blank, Save sends email:'' address:'' doNotSendUpdate:false, wiping the counter PC's data and any opt-out.

- **Reopening an order whose sized item is now Out of Stock compounds the size into the stored name on every save** — `client/src/pages/POS.tsx:769` (R08)  
  Table orders Cold Coffee (Large); later the item is toggled Out of Stock. Reopening the table and saving stores 'Cold Coffee (Large) (Large)'; the next save stores 'Cold Coffee (Large) (Large) (Large)', and the printed bill shows that name.

- **A manual KOT/Bill tap while an Auto-KOT PUT is already in flight sends a second print request concurrently; the server's KOT delta has no lock, so both can print the same delta** — `client/src/pages/POS.tsx:918` (R08)  
  Staff add Butter Naan; 1.5s later Auto-KOT fires its PUT; under the documented multi-second connection stall it is still in flight when staff tap KOT at 3s. Both requests reach the server together, both read the pre-print snapshot, and the kitchen printer gets two identical '+1 Butter Naan' tickets.

- **'+ New Order' (and 'Clear all') clears the cart but keeps activeOrderId, so the 'new' order is saved into the previous order and fails with 400** — `client/src/pages/POS.tsx:2037` (R08)  
  Pickup POS: staff KOT customer A's order (activeOrderId set), tap '+ New Order' for customer B, add items and tap KOT. onSubmit takes the update branch and PUTs B's items to A's order; all of A's persisted lines are now 'dropped' with no reasons, so the server answers 400 'reason required' and B's order cannot be placed (if a reason were given, A's order would be overwritten with B's items).

- **RawBT ack ignores non-2xx responses, leaving the job 'claimed' so it is reclaimed and printed again after the 2-minute stale window** — `client/src/pages/PrintStation.tsx:47` (R08)  
  A KOT is handed to RawBT and printed; the ack hits a transient 500 (or a cold-start 503). Ten minutes later the tablet's screen wakes (visibilitychange) and pollPendingJobs re-claims the stale job — the kitchen gets the same KOT a second time.

- **Live PRINT_JOB handling reads a single last-wins lastMessage state, so a PRINT_JOB followed closely by any other realtime event (or a second PRINT_JOB) is never claimed until a reconnect/visibility change** — `client/src/pages/PrintStation.tsx:132` (R08)  
  A mixed order routes KOTs to two printers both owned by the RawBT tablet (or a KOT then immediately a Bill). Pusher delivers PRINT_JOB(printer A), PRINT_JOB(printer B), ORDER_UPDATE within a few ms; React renders once with ORDER_UPDATE (or only job B). Job A stays 'pending' in print_jobs and its ticket never prints at the counter while the tablet sits on /print-station with the screen on.

- **CSV import parser splits on every comma, ignoring quoted fields, shifting columns (prices) silently** — `client/src/pages/Settings.tsx:660` (R09)  
  Menu row `"Paneer Tikka, Half",Starters,280,...` imports name 'Paneer Tikka', category ' Half', price 'Starters' (rejected) — or a description with a comma moves text into the wrong field; for customers an address with commas pushes locality/DOB/tags into the wrong columns and corrupts customer records.

- **'Delete All Orders' says 'Type your admin PIN to confirm' but no PIN is asked or checked** — `client/src/pages/Settings.tsx:1145` (R09)  
  Anyone at a device left logged in as the admin (the owner's desktop) taps Remove All Orders -> Continue -> Delete All Orders and the entire sales history is gone; the text implied a PIN would stop it.

- **Default attendance/summary/sales range starts on the last day of the previous month** — `client/src/pages/Staff.tsx:32` (R09)  
  Manager opens Staff in November: Summary shows present days / hours including 31 Oct, the stat strip and attendance % are inflated, and the Sales tab revenue includes 31 Oct orders. On the 1st before 05:30 IST Payroll opens on the previous month.

- **Payroll print register interpolates staff names/roles into HTML unescaped in a same-origin blob page** — `client/src/pages/Staff.tsx:498` (R09)  
  A staff member's name is saved as `<img src=x onerror=fetch('/api/...')>` (via Admin → Accounts by any account able to edit names); when the owner prints the payroll register the script runs as the owner with full API access.

- **'Cannot delete a table with an active order' is a client-only check on possibly stale data** — `client/src/pages/Tables.tsx:331` (R10)  
  A waiter opens an order on T4 from a phone; within the poll window the manager on the PC still sees T4 as free and deletes it. The table row (and its currentOrderId link) is gone while the order is still open, so the running bill no longer appears on the Tables page.

- **Reconnect creates a new ZkAdapter without disconnecting the previous one** — `desktop/attendance/attendanceAgent.ts:138` (R10)  
  The K30 is busy for one sync (getAttendances throws once). Every following reconcile opens a new session while the old one still holds the device; the new connects time out, the panel shows 'Last error: Timed out connecting' indefinitely and live punches from the orphaned session keep firing duplicate flushes. While the device is unreachable for a day, one orphaned ZKLib/socket is created per sync interval.

- **Main-process printer config is cached forever; edits made from any other device never reach the print queue** — `desktop/main.ts:266` (R10)  
  Owner adds a new category-routed printer (or re-detects a Windows queue name / changes a network printer IP) from the phone on Vercel. The shop PC's renderer sees the new config and claims the job, but executor throws 'Printer "p-new" not found in settings' (or sends to the old IP/queue), retries 3 times, releases it, and the ticket is not printed until the Electron app is restarted.

- **No setWindowOpenHandler/will-navigate: wa.me and other external links open as Electron windows inheriting the app preload** — `desktop/main.ts:322` (R10)  
  Staff clicks 'Send WhatsApp' in Customers on the shop PC: an Electron window opens on whatsapp.com instead of WhatsApp Desktop, with electronAPI exposed to that remote origin.

- **Dedup drops a genuinely different KOT ticket (different print_jobs id) for the same order+printer while the first is still in flight** — `desktop/print/printQueue.ts:107` (R10)  
  Staff taps KOT for table 5 (adds Paneer); while that ticket is printing or retrying (printer slow / offline, retries take up to ~17 s) they add Butter Naan and tap KOT again. Server creates job #2 for the Naan delta, the host claims it, enqueue() dedups it into job #1 and returns ok. The kitchen never gets the Naan ticket, and the POS shows 'KOT sent to printer'.

- **libusb bulk transfer has no timeout — a stalled printer wedges the whole print queue (macOS/Linux hosts)** — `desktop/print/usbLibusb.ts:58` (R10)  
  On a Mac thin client the USB thermal printer runs out of paper mid-ticket: the transfer never completes, every later KOT/Bill sits 'pending' in the local queue (already claimed on the server), and nothing prints until the app is restarted.

- **order.coupon_applied / order.loyalty_redeemed audit rows are fire-and-forget** — `server/growthRoutes.ts:355` (R11)  
  On Vercel a coupon discount is applied and the response returns; the function is frozen before the audit INSERT runs, so Reports -> KOT & Bill Activity has no record of the discount.

- **POST /api/automation/birthday/run is requireAuth but force-sends real WhatsApp messages** — `server/growthRoutes.ts:509` (R11)  
  Any staff-tier PIN session (or a script with its cookie) POSTs /api/automation/birthday/run repeatedly; each call forces a birthday send run to customers, bypassing the scheduler's once-per-day gating intent and raising WhatsApp ban risk.

- **PIN rate limiter (5 per 5 min, counts successes) is shared by the whole restaurant's single public IP** — `server/routes.ts:415` (R12)  
  During a busy evening, managers approve 5 PIN actions across the till and phones within 5 minutes; the 6th correct PIN gets 429 'Too many PIN attempts' and staff cannot apply a discount or cancel an item for up to 5 minutes.

- **/api/admin/migrate runs `drizzle-kit push --force`, auto-approving destructive DROPs, while the UI calls it non-destructive** — `server/routes.ts:1010` (R12)  
  After a deploy where shared/schema.ts lags a column added via a scripts/migrate-*.mjs ALTER, the admin clicks 'Sync Schema'; drizzle-kit drops that column (and its data) on the production DB with no confirmation.

- **Reset Bill Number sets billCounter=0 while old orders still exist → every new order collides with UNIQUE order_number** — `server/routes.ts:1046` (R12)  
  Admin uses the Settings 'Reset bill number' button (offered independently of Clear Orders) at day start. Every POST /api/orders then fails with 500 until the counter has been burned past the existing maximum (hundreds of failed attempts) or the server restarts; on Vercel only freshly-booted instances recover.

- **Menu price — the floor shared/orderPricing.ts relies on — can be rewritten by any logged-in session, unvalidated** — `server/routes.ts:1687` (R17)  
  A staff-tier PIN session (or curl with its cookie) sends PUT /api/menu/12 {price:"1", sizes:null}, rings a ₹500 dish at ₹1 (the server floor now accepts it), settles, then restores the price. Or a typo of "-50" makes every order containing the item total ₹50 less per unit.

- **POST /api/orders spreads unvalidated client orderInfo into the insert — status 'cancelled'/'served' etc. can be set at creation** — `server/routes.ts:2093` (R12)  
  A staff session posts an order with status:'cancelled': the kitchen ticket is still created, food is served and cash collected, but the order is excluded from all sales figures, cannot be settled, and there is no order.cancel audit row — bypassing the manager-elevated, audited cancel path. status:'served' likewise creates an instant phantom 'due'.

- **Creating a dine-in order never checks the table is free; a second order silently overwrites table.currentOrderId** — `server/routes.ts:2150` (R12)  
  Waiter on phone and cashier at the till both start an order on Table 4 within a few seconds. Two orders exist; the table card points only at the second, so the first order (with its KOT already in the kitchen) is invisible from the table and is never billed/settled from the table flow.

- **Payment route frees order.tableId even when settling an old due whose table now belongs to another running order** — `server/routes.ts:2721` (R13)  
  Yesterday's table 4 bill was marked Due. Tonight table 4 is running a new order. The cashier settles yesterday's due from Billing: table 4 flips to 'free' with currentOrderId null, the running order vanishes from the Tables page and the next party is seated on it.

- **Loyalty points, settlement WhatsApp and feedback scheduling are fire-and-forget before res.json on Vercel** — `server/routes.ts:2777` (R13)  
  A customer settles a paid bill on the Vercel deployment; the function is frozen right after res.json and earnPointsForOrder's insert never runs. The customer's loyalty balance silently misses the points (later redeemable money), and the welcome/thank-you message is never enqueued — with no retry because the order is now paid.

- **Cancel has no paymentStatus/status check and no conditional write — a paid order can be cancelled (and a concurrent settle overwritten)** — `server/routes.ts:3125` (R13)  
  A manager cancels a pickup order that was settled for ₹500 cash minutes earlier (Actions menu offers Cancel for pickup/delivery). Sales drops by ₹500 but Payments still shows the ₹500 cash, and inventory is restored for food that was served; Reports' two tabs disagree. A double-tap logs two 'Cancelled' KOT events.

- **Print-on-table-move bypasses the print pipeline: getSettings() fallback, direct sendToPrinter after res.json, no print_jobs bridge** — `server/routes.ts:3214` (R13)  
  Owner enables 'Print KOT on table move' with the kitchen printer on the Electron host. Staff move table 3 -> 8 from a phone (Vercel): no ticket ever prints and nobody is told, so the kitchen keeps sending food to table 3.

- **Merge does not reject targetOrderId === sourceOrderId or non-running orders — merging an order into itself deletes it** — `server/routes.ts:3253` (R13)  
  A manager taps a running table whose currentOrderId equals the order open in POS (e.g. a table left pointing at the order after a move/shift failure). The order and all its items are permanently deleted and the response is {success:true}; the KOT tickets are orphaned.

- **Merge drops the source order's discount — merged bill is higher than the two bills it replaced** — `server/routes.ts:3268` (R13)  
  Table 2 (₹1,000, manager-approved ₹100 discount) is merged into table 5 (₹800, no discount) at 5% tax. Before: 945 + 840 = ₹1,785. After merge: (1,800 − 0)×1.05 = ₹1,890 — the customer is billed ₹105 more and the approved discount leaves no trace on the surviving order.

- **PUT /api/kot/:id flips the parent order to ready/preparing unconditionally — resurrects cancelled orders and pulls served/paid orders back to active** — `server/routes.ts:3460` (R13)  
  An order is cancelled (status 'cancelled', tickets completed). The kitchen tablet still shows the old ticket and the cook taps 'Mark Ready': the route sets the order to 'ready', so the cancelled order is now counted in Total Sales, Top Items and Live View 'Active Orders'. Same for a settled order (served -> ready): it reappears as an active floor order the day after.

- **Off-site backup omits restaurant_settings and the HR/print/conversation tables** — `server/services/backupService.ts:48` (R13)  
  The DB is lost and restored from the R2 backup: orders restore, but the tax rate/printer/counter settings are gone (the app 503s on settings until rebuilt by hand, and bill numbers restart and collide with restored orders' UNIQUE orderNumber), and all attendance/leave/salary history is unrecoverable.

- **Birthday/anniversary wishes bypass the WhatsApp driver: with Baileys they are dry-run yet recorded as 'sent'** — `server/services/birthdayService.ts:304` (R13)  
  Owner pairs WhatsApp via Baileys and turns on birthday automation. Every birthday customer gets a BDAY coupon created but never receives any message; automation_jobs shows BIRTHDAY 'sent'.

- **Daily rule engine and hourly engine dedup on different keys, so a customer can get two re-engagement messages the same day** — `server/services/crm/automationRuleEngine.ts:334` (R14)  
  At 10:00 the rule engine sends 'INACTIVITY' to a 35-day-lapsed customer. At the next hourly tick, enqueueWhatsApp finds no same-day 'WIN_BACK' job and queues a second win-back message to the same person.

- **WATI and MSG91 senders treat any 10-digit number starting with '91' as already country-coded** — `server/services/crm/messagingService.ts:51` (R14)  
  With WATI configured (no driver), a due reminder or automation message to a customer whose number is 9187654321 is posted to /sendSessionMessage/9187654321, which fails or goes to the wrong number. The same happens for MSG91 SMS.

- **resolveCustomerId called without a phone from logging/loyalty paths creates duplicate customers_master rows and splits customer identity** — `server/services/crm/messagingService.ts:242` (R14)  
  A customer was created by name 'Asha' and her phone was later linked (master key 'Asha', phone 98xxxxxxxx). Orders now carry the phone, so key = phone. The first settlement's earnPointsForOrder(phone, 'Asha') inserts a second master row keyed by the phone. Next morning buildSnapshots looks up the profile by masterMap.get(phone), gets the duplicate with no profile, and her doNotSendUpdate opt-out on the original row is ignored. Segments and today's-job dedup also split.

- **CRM aggregates (segments, settlement snapshot, rule-engine snapshot) count cancelled orders as visits and spend** — `server/services/crm/segmentationService.ts:98` (R14)  
  A new customer's first order is cancelled and re-rung. At settlement, buildSnapshotForKey sees totalVisits=2, so instead of WELCOME they get the returning-customer THANK_YOU 'for dining with us again'. A customer whose only order was cancelled gets win-back messages 30 days later, and cancelled high-value test orders can push someone into VIP.

- **Hourly batch segmentation is an unconditional N+1 over every distinct (phone,name) pair, and skips name-only customers whose phone is ''** — `server/services/crm/segmentationService.ts:173` (R14)  
  With ~500 customers, each hour issues ~2,000+ sequential queries including ~500 sequential scans of orders, against the shared Supabase DB. A name-only regular whose phone is '' stays 'Regular' forever and never appears in the digest's at-risk count.

- **Hourly automation run downloads the entire orders, order_items and menu_items tables** — `server/services/customerAutomationService.ts:83` (R14)  
  With automation enabled, 24 runs a day × (orders + order_items + menu_items) is tens of MB a day of Supabase egress that grows with history, which is the same failure mode as the Oct 2026 quota blow-out.

- **Favourite item ignores order_items.name, so open items become a favourite called 'Unknown'** — `server/services/customerAutomationService.ts:144` (R14)  
  A regular whose recent orders include a few open items ('Special Thali' typed manually) settles a bill. In 'auto' mode the tag is Regular with favoriteItem 'Unknown', so they receive 'We know you love *Unknown* at Bagicha!'.

- **Hourly engine's legacy send path checks only the file-based opt-out, not the DB STOP flag** — `server/services/customerAutomationService.ts:331` (R14)  
  With Meta Cloud API configured and autoSend off, a customer who replied STOP is still sent a WIN_BACK message after 30 days of inactivity.

- **Owner's daily digest counts cancelled orders as revenue and due, ignores write-offs, and treats still-open orders as due** — `server/services/dailyDigestService.ts:64` (R14)  
  On a day with one ₹1,200 cancelled order, two tables still running at 23:00 (₹1,800) and a ₹50 write-off, the WhatsApp digest overstates Revenue by ₹1,250 and shows 'Due: ₹3,000' although no customer owes anything. It also disagrees with Reports for the same day.

- **Feedback requests ignore customer opt-out** — `server/services/feedbackService.ts:95` (R14)  
  A customer who replied STOP (or was marked 'do not send updates' by staff) still gets a 'rate your experience' WhatsApp after every paid order.

- **Overlapping minute ticks double-send feedback requests; failed rows are retried every minute forever and can starve the queue** — `server/services/feedbackService.ts:137` (R14)  
  After enabling feedback (or after downtime) with 60 eligible paid orders, customers in the overlap window receive the rating request twice. A handful of numbers that Meta rejects are re-posted 1,440 times a day each, and once 50 accumulate, no new feedback request is ever sent.

- **Public feedback submit issues a ₹100 recovery coupon before an unconditional write; a non-integer rating re-issues coupons without limit** — `server/services/feedbackService.ts:203` (R14)  
  Someone with a feedback link POSTs /api/feedback/<token>/submit with {rating: 2.5} in a loop. Each call issues a new SORRY ₹100 flat coupon, then fails the UPDATE, so the link never locks. A normal customer double-tapping Submit on a 2-star rating gets two coupons.

- **KOT delta check-then-commit has no lock: two concurrent KOT prints of one order both send the same delta to the kitchen** — `server/services/printDispatch.ts:253` (R15)  
  A waiter's phone and the counter PC both have the same table open; one taps KOT while the other taps Bill (whose catch-up runs runKotPrint), or the Auto-KOT timer fires while staff tap KOT. Both requests compute 'new: 2 Butter Naan' from the same snapshot and the kitchen receives two tickets and cooks 4 naan.

- **A customer's STOP is ignored whenever the bot is disabled or a human has taken over the thread** — `server/services/whatsapp/inboundService.ts:72` (R15)  
  Customer writes 'complaint' (HANDOFF, botActive=false), then 10 minutes later writes 'STOP'. Nothing is recorded; the hourly/daily engines and settlement messages keep sending WhatsApp messages to someone who opted out — a ban/complaint risk the opt-out exists to prevent. Same if the admin turns botEnabled off but leaves whatsappAutoSend on.

- **mergeOrders/splitOrder move items without moving their stock_movements, so stock is double-deducted after a merge (or wrongly restored after a split); merging an order into itself deletes it** — `server/storage.ts:1140` (R16)  
  Table 4 (2 Paneer Tikka) is merged into Table 5, and staff then add a drink to Table 5. The save's reconcile deducts the paneer for 2 Paneer Tikka a second time. The inventory page shows paneer short by that amount and low-stock or negative-stock alerts fire. A manager API call to POST /api/orders/merge with the same id for both permanently deletes the order.

- **Payroll credits a leave's entire totalDays to the month it STARTS in, so leave spanning a month boundary docks the next month's pay** — `server/storage.ts:2040` (R16)  
  A cook on ₹15,000/month takes approved leave from 30 Oct to 3 Nov. The November payroll row (and /api/payroll/me) shows 3 absent days and deducts about ₹1,500, even though the leave was approved and paid.

- **detectSessions pairs punches strictly in sequence, so one duplicate/stray biometric punch flips every later in/out pair** — `shared/shiftTime.ts:73` (R18)  
  Staff scans at 09:00 and again at 09:01 (first beep missed), leaves at 17:00. Pool [09:00,09:01,17:00] -> sessions (09:00-09:01 = 0.02h) and an open session at 17:00 (0h). Attendance row gets workingHours 0.02 and status 'half-day' for a full 8h day; the bad sessions are persisted as auto rows and re-pooled on every later sync, so it never self-corrects (only a manual Recompute after fixing the logic).


## Low

- **Manual WhatsApp Send silently does nothing for 10-digit numbers starting with 91** — `client/src/components/AutomationPanel.tsx:167` (R01)  
  Customer with phone 9187654321 appears in the Send queue; staff tap Send and nothing happens (no wa.me tab, no toast), so that customer can never be followed up from this screen.

- **Config saves ignore HTTP errors, fire on every keystroke and can land out of order** — `client/src/components/AutomationPanel.tsx:347` (R01)  
  Owner types phone 919876543210 quickly; the POST for '91987654321' is processed after the final one and the digest goes to an invalid number, with the UI still showing the full number. Or the session lacks admin (403) and 'Save Credentials' shows 'Saved' while nothing was stored.

- **Digest hour 0 and birthday hour 0 cannot be entered — `Number(v) || 23` / `|| 9` turns 0 into the default** — `client/src/components/GrowthSettingsPanel.tsx:207` (R02)  
  Owner wants the digest at 00:00 after closing; enters 0, the box jumps to 23 and the digest is sent an hour before closing with incomplete figures.

- **Printer 'Offline' badge never clears when the printer comes back online** — `client/src/components/PrintSettingsPanel.tsx:285` (R02)  
  Kitchen printer is briefly unplugged while the admin has Print Settings open; after reconnecting and a successful test print the card still says Offline, prompting needless troubleshooting/re-adding (which then triggers the dangling-id problem above).

- **2FA status query parses error bodies as status, showing 'Disabled' when 2FA is actually enabled** — `client/src/components/TwoFactorPanel.tsx:15` (R03)  
  Status fetch 500s for an admin with 2FA on; the panel says Disabled. Admin re-runs setup, which issues a new secret; after verifying, the old authenticator entry stops working, causing confusion at next login.

- **Relative day labels use elapsed 24h periods instead of calendar days** — `client/src/components/conversations/ThreadList.tsx:9` (R03)  
  Agent sees '11:00 pm' on a thread at 9 AM and assumes the customer wrote last night vs. today inconsistently with ChatView's calendar-based 'Today/Yesterday' separator.

- **saveConfig updates the UI optimistically and swallows every save failure** — `client/src/components/conversations/WhatsAppConnectionCard.tsx:84` (R03)  
  A non-admin (or a failed request) flips 'Auto-send follow-ups' on: the toggle shows ON, server returns 403/500, nothing is saved, and the user believes automated sending is enabled.

- **Numeric settings clamp and POST on every keystroke, making many values untypeable and persisting intermediate caps (incl. maxPerDay)** — `client/src/components/conversations/WhatsAppConnectionCard.tsx:224` (R03)  
  Admin wants 'Return to bot after' = 15: typing '1' immediately becomes 5, then '5' yields 55 — any value 10-49 starting with 1-4 can't be typed. Clearing maxPerDay to retype it instantly saves 100 (the ban-risk cap the card warns about); several in-flight POSTs can land out of order, persisting an intermediate value.

- **Customer total spend / visits / VIP tags count cancelled orders** — `client/src/hooks/useCustomerIntelligence.ts:120` (R04)  
  A customer whose ₹1,500 order was cancelled (wrong table, test order) shows ₹1,500 more spend and an extra visit. They can cross into 'High' spend / VIP and get VIP suggestions and loyalty points (see the useLoyalty finding) they never paid for.

- **Every useLiveOrders instance polls open orders plus one detail fetch per order every 30 s, even while hidden** — `client/src/hooks/useLiveOrders.ts:152` (R04)  
  An idle shop PC with POS in section mode plus Tables in a background tab sends 2 x (1 + N) requests every 30 s all day, about 20+ requests a minute with 8 open orders. The order detail rows add Supabase egress and keep connections busy, and they also compete with settle/print requests on the slow CGNAT link.

- **playBeep creates a new AudioContext per beep and never closes it** — `client/src/hooks/useLiveTableOperations.ts:138` (R04)  
  On a long service Live View accumulates hundreds of live AudioContexts. Chrome then refuses new ones (error caught silently) or holds extra audio threads, so the new-item beep goes silent mid-shift.

- **TABLE_UPDATE arriving while a loadAll is in flight is silently dropped** — `client/src/hooks/useLiveTableOperations.ts:183` (R04)  
  A table is settled (TABLE_UPDATE) while the 30 s poll or a previous TABLE_UPDATE's reload is fetching order details. Live View keeps showing the table as running/billed with its old items for up to 30 s, and staff seat a party at a 'busy' table or chase a bill already paid.

- **Customer-page loyalty card is a localStorage-only ledger disconnected from the server loyalty system** — `client/src/hooks/useLoyalty.ts:61` (R04)  
  A staff member clicks Redeem for a customer showing 200 pts / ₹20. The card now says 0 available on that browser, but the customer's real server balance is unchanged and no discount was applied. Another device still shows 200, and points include orders that were cancelled.

- **WATI API key and Meta access token persisted in plaintext localStorage** — `client/src/lib/automationEngine.ts:64` (R05)  
  Admin enters the Meta token on the shared shop PC; any later user of that browser (or an injected script) can read localStorage['bagicha_automation_settings'] and send messages as the restaurant's number.

- **printBillDirect parses the body as JSON before checking res.ok** — `client/src/lib/printGateway.ts:181` (R05)  
  Tables-card print during a Vercel timeout shows an unintelligible JSON parse error to staff.

- **Preview KOT/bill dates use the browser's ambient timezone instead of IST** — `client/src/lib/receiptText.ts:39` (R05)  
  On a device/OS left on UTC (e.g. a fresh Android tablet), a preview at 21:30 IST shows 16:00, and quiet hours 22–09 are evaluated in UTC so web-mode sends can go out at 02:30 IST.

- **In-page bill preview reconstructs Subtotal as total - tax - charges, which is wrong whenever a discount exists** — `client/src/lib/receiptText.ts:138` (R05)  
  Order: items ₹1000, 10% discount, 5% GST → total ₹945. Preview shows Subtotal ₹900, Discount -₹100, Tax ₹45, TOTAL ₹945 — the lines don't foot (900-100+45=845), and staff reading the preview quote a wrong subtotal.

- **Loyalty balance fetch is not cancelled when the paying order changes** — `client/src/pages/Billing.tsx:140` (R06)  
  Cashier opens order A (customer with 800 pts), closes, opens order B within a second; A's response arrives last, B's dialog shows 'Redeem 800 pts' and the request tries to redeem 800 of B's points.

- **After 'Payment processed! Printing bill...', a failed bill print is silent** — `client/src/pages/Billing.tsx:160` (R06)  
  Settings re-read 503s or the network drops after payment; staff were told the bill is printing, nothing comes out and nothing says so - customer leaves without a bill.

- **applyCoupon first sends a bogus /api/coupons/apply with couponId 0** — `client/src/pages/Billing.tsx:246` (R06)  
  Every Apply tap costs an extra serial round trip (seconds on the shop's stalling network) and, for a manager session, a redeemCoupon(0,...) call on the server.

- **Billing offers Card and Online methods that the Cash/UPI-only reports cannot show** — `client/src/pages/Billing.tsx:694` (R06)  
  Cashier marks a ₹1,200 bill paid as 'Card' (restaurant takes only cash/UPI, so it was really UPI). Tables pill: Sales ₹X but Cash+UPI = ₹X-1,200; Reports Payments tiles are ₹1,200 short and the closing cash book cannot reconcile.

- **saveExtras writes localStorage without try/catch inside an effect** — `client/src/pages/CustomerDashboard.tsx:89` (R06)  
  On a device whose localStorage is full or blocked, toggling a customer's notification crashes the Customers page.

- **Listing rows have an uncapped per-row fade-in delay (i * 0.01s)** — `client/src/pages/CustomerDashboard.tsx:539` (R06)  
  With 800 customers, row 800 stays invisible for 8s after the tab opens; staff scrolling to a customer see blank space and think the list is empty/broken.

- **Category pie tooltip shows rupee totals as 'N sold'** — `client/src/pages/Dashboard.tsx:33` (R06)  
  Hovering 'Pizza' slice shows '4500 sold' instead of ₹4,500.

- **KOTCard is declared inside the page component, so every page render remounts every ticket card** — `client/src/pages/KOT.tsx:133` (R06)  
  Kitchen taps 'Start Cooking': isPending flips twice and the toast fires, so the whole board blinks and re-animates 3 times; with 20 tickets the last card fades in ~0.8s later each time.

- **Header 'N ready' counts cancelled and auto-completed tickets** — `client/src/pages/KOT.tsx:288` (R06)  
  An order is cancelled; its ticket shows 'Cancelled' on the card but the header still says '1 ready'.

- **Clock and elapsed-time labels freeze; header says 'Auto-refresh · 5s' but polls are 15s** — `client/src/pages/LiveAnalytics.tsx:74` (R06)  
  Quiet afternoon with 2 open orders: the header clock shows 3:05 PM at 3:40 PM and an order open 40 min still says '5m'.

- **Delivery/pickup status maps in localStorage are never pruned** — `client/src/pages/LiveTablesDashboard.tsx:123` (R06)  
  After months of use the maps hold thousands of ids; every NEW_ORDER/ORDER_UPDATE re-parses them on each device.

- **Login card keys use bare id, but staff-member and user cards share the id space** — `client/src/pages/Login.tsx:449` (R07)  
  Staff member id 4 and a manager account id 4 both have mobile cards: React sees duplicate keys, warns, and on any re-render/reorder can reuse the wrong element (stale animation/initial state, or a card dropped from reconciliation).

- **Bulk 'Change %' rejects negative percentages, so prices can never be reduced in bulk** — `client/src/pages/Menu.tsx:207` (R07)  
  Admin selects 20 items and enters -10 in 'Change %' to cut prices by 10%; the page toasts 'Invalid value' and nothing changes, so every item must be edited individually.

- **Percent bulk price update is non-atomic; a retry after partial failure compounds the change** — `client/src/pages/Menu.tsx:244` (R07)  
  Admin applies +10% to 15 items; 12 succeed, 3 fail on a network blip. The toast says it failed and the grid is not refreshed. After the next refetch (or immediately, if the admin reselects and retries) the admin taps Update again: the 12 already-raised items get a second +10% (≈+21% total) while the 3 failed ones get +10%.

- **Reprint Bill failure silently shows an unprintable text preview with no error** — `client/src/pages/Orders.tsx:131` (R07)  
  Settings are briefly unavailable (503); staff tap Reprint Bill, get a preview modal and assume it is the bill, with no indication the print request failed.

- **Expanded row shows 'Loading…' spinner forever when the detail fetch fails or the order has no items** — `client/src/pages/Orders.tsx:323` (R07)  
  An order whose items were all cancelled (items: []) or whose /api/orders/:id fetch 404s/500s shows a perpetual spinner instead of 'No items' or an error.

- **Cancelled tab content exists but has no TabsTrigger** — `client/src/pages/Orders.tsx:760` (R07)  
  A manager wants to see only cancelled orders in Order History; there is no tab for it, they must scroll the All list.

- **Hold / Move Table / Merge don't save the cart first, silently discarding items added since the last save** — `client/src/pages/POS.tsx:397` (R08)  
  Running table: staff add 2 Lassi (Auto-KOT off), customer asks to move tables; staff use Actions → Move Table (or Hold). The move/hold succeeds, the POS navigates away, and the 2 Lassi never reach order_items, the kitchen or the bill.

- **KOT tap toasts 'KOT sent!' on save success before the print result is known** — `client/src/pages/POS.tsx:1037` (R08)  
  Kitchen printer offline: staff see 'KOT sent!' and then 'KOT print failed'; a glance at the first toast suggests the kitchen has the ticket.

- **Short-code entry bypasses required variant groups (and the notes picker)** — `client/src/pages/POS.tsx:1590` (R08)  
  Item 'Maggi' with a required 'Spice level' variant typed by short code is added with no spice level, so the KOT carries no variant and the kitchen has to ask.

- **Recall Held order has no error handling — a failed recall closes the dialog and does nothing, with an unhandled rejection** — `client/src/pages/POS.tsx:1815` (R08)  
  Recall request fails (network stall, 409 because another device already recalled it): the dialog disappears and staff see no feedback; the order stays on hold.

- **Report date presets use UTC calendar date (toISOString), not the IST business day** — `client/src/pages/Reports.tsx:25` (R09)  
  Owner opens Reports on any day choosing 'This Month': totals include all of 31 Oct as well (inflated monthly sales/top items/payments). Opening Reports at 05:15 IST shows yesterday's figures under 'Today'.

- **E-bill wa.me fallback opens a window after an awaited request, so it is often popup-blocked** — `client/src/pages/Reports.tsx:447` (R09)  
  Owner taps Send e-bill on an iPhone with no WhatsApp driver connected; nothing opens but the toast claims it is opening, and the customer never gets the bill.

- **'Generate Pairing Code' fabricates a random client-side code that nothing on the server knows** — `client/src/pages/Settings.tsx:525` (R09)  
  Admin tries to pair a new terminal with the generated code; it cannot work, and they lose time debugging pairing.

- **Header-skip heuristic always drops the first row when it starts with text** — `client/src/pages/Settings.tsx:697` (R09)  
  Admin uploads a header-less list of 50 customers; 49 are imported and the first customer is silently skipped (preview count already excludes it, so nothing signals the loss).

- **Recompute toast always reports 0 days updated** — `client/src/pages/Staff.tsx:146` (R09)  
  Admin runs Recompute, sees '0 attendance day(s) updated' and assumes it did nothing, re-running it or filing a bug.

- **Leave with end date before start date is submitted as a 1-day leave** — `client/src/pages/Staff.tsx:302` (R09)  
  Manager picks From 20 Nov, To 12 Nov by mistake; a 1-day leave with an inverted range is stored, and once approved it is counted by payroll's approvedLeaves while the overlap check (lte/gte on start/end) can never match it.

- **Attendance/summary/performance queries turn any error into an empty list** — `client/src/pages/Staff.tsx:621` (R09)  
  During a DB blip the manager checks attendance before payroll, sees 'No attendance records' and concludes the biometric device stopped syncing (or that staff were absent).

- **Sales tab keys rows by bare staffId, which collides across users and staffMembers** — `client/src/pages/Staff.tsx:990` (R09)  
  Two people with the same numeric id both sold in range -> duplicate React keys; on a date change React reuses the wrong row/motion element, so a row can show stale data or be dropped.

- **Shift/Edit/Delete controls are opacity-0 until hover — invisible on touch and keyboard, but still clickable** — `client/src/pages/Tables.tsx:675` (R10)  
  A staff member on a phone taps the lower-right of a free table card to open it and instead triggers the 'Delete table?' confirm or the Shift PIN prompt; Shift Table is otherwise undiscoverable on touch.

- **normalizePhone uses startsWith("91") — the bug CLAUDE.md says was fixed server-side still lives in the client wa.me path** — `client/src/utils/whatsapp.ts:54` (R10)  
  Owner taps Thank You for a customer whose phone is 9187654321: nothing opens but the button flips to 'sent'. For 09876543210 WhatsApp opens on a non-existent number.

- **start() check-then-act: concurrent start (bootstrap timer vs ATTENDANCE_REFRESH, or two refreshes) runs two agents** — `desktop/attendance/attendanceAgent.ts:70` (R10)  
  Admin clicks Save on the Device panel twice quickly (or saves just as the 30 s bootstrap timer fires): two reconcile/flush loops and two device sessions run for the rest of the app session; refresh/stop never stops the orphaned one.

- **Overlapping flush() calls slice the buffer by their own batch length, dropping unsent punches** — `desktop/attendance/attendanceAgent.ts:192` (R10)  
  After an outage the buffer has 250 punches; timer flush A and reconcile flush B both send the first 200. A succeeds (50 left, continuation C sends them), B succeeds and empties the buffer, C fails on a network blip: the last 50 punches are gone and the cursor is already past them, so reconcile never re-sends them.

- **Embedded server restart budget (5) is per app lifetime and has no backoff** — `desktop/main.ts:163` (R10)  
  Host PC runs for two weeks; the server child crashes 5 times on transient DB errors. The 6th crash leaves the POS UI and Baileys dead with only a console warning until someone restarts the app.

- **Test print double-centres lines and formats time with the PC's ambient timezone** — `desktop/main.ts:283` (R10)  
  The test ticket's printer name/time/message lines print shifted right of the 'TEST PRINT' heading, and on a PC not set to IST shows the wrong time.

- **Postgres TLS certificate verification disabled** — `server/db.ts:13` (R10)  
  The embedded host build on the restaurant Wi-Fi connects through a hostile/compromised router performing TLS interception; the DB password and every query are exposed without any error.

- **Coupon apply / loyalty redeem rewrite totals of paid or cancelled orders and race on discount** — `server/growthRoutes.ts:316` (R11)  
  (a) Billing applies a coupon to an order already settled: totalAmount drops while paidAmount stays, so Reports' net revenue (totalAmount - shortfall) changes after the fact and the order looks overpaid. (b) Two coupons applied near-simultaneously to one order: both redemptions are recorded (coupons consumed) but only one discount lands on the bill. (c) Loyalty redeem with an orderId of a cancelled order deducts points onto a dead order.

- **Loyalty points deducted even when the supplied orderId does not exist** — `server/growthRoutes.ts:430` (R11)  
  Client sends a stale/merged-away orderId (merge deletes the source order); the customer's points are debited, response says ok with discount ₹X, but no bill is discounted.

- **GET /api/feedback with non-numeric limit passes NaN to LIMIT** — `server/growthRoutes.ts:495` (R11)  
  ?limit=all returns 500 instead of a default page.

- **Test print uses server-local time and E.centered under ALIGN_CENTER** — `server/printRoutes.ts:602` (R11)  
  On a non-IST host the test page shows a UTC time; the printer name/time lines drift right of the natively-centred title.

- **Legacy /api/auth/staff-pin-login ignores showOnMobile, so turning a person's Mobile Card off doesn't stop PIN login** — `server/routes.ts:584` (R12)  
  Admin switches a staff member's Mobile Card off to revoke their phone login; they (or anyone knowing their id+PIN) can still POST /api/auth/staff-pin-login and get a staff session.

- **GET /api/orders/:id does one SELECT * per distinct menu item (N+1) on a hot path** — `server/routes.ts:1969` (R12)  
  Reopening a 20-line table order issues ~22 queries at once, taking up to 20 of the 10 pool connections and queueing other requests on the instance; egress is the full menu row per item each time.

- **NEW_ORDER broadcast carries the full order row plus the raw client items array — can exceed Pusher's ~10 KB event limit** — `server/routes.ts:2158` (R12)  
  A large party order (~40 lines with add-ons) produces an event over 10 KB; Pusher rejects it and other devices miss the NEW_ORDER until a fallback poll (15 s+).

- **items_edit audit compares the stored (2-dp) total against the unrounded priced.total, logging spurious 'Bill Modified' rows** — `server/routes.ts:2469` (R13)  
  Staff adds a customer phone to a running table's order: Reports -> KOT & Bill Activity shows a 'Bill Modified' event although the bill is identical.

- **Payment route hand-rolls settlement math and accepts arbitrary method labels instead of resolveSettlement + cash/UPI validation** — `server/routes.ts:2632` (R13)  
  A settle with payments:[{method:'card',amount:500}] (or Billing's Card option) is recorded as paid ₹500: Tables 'Sales ₹T' includes it but Cash + UPI no longer add up to Sales, and Reports -> Payments shows the ₹500 nowhere.

- **move-table doesn't verify the target table is free or the order still active; overwrites another order's table assignment** — `server/routes.ts:3177` (R13)  
  Two waiters each open Move Table and pick table 7 within seconds. The second move sets table 7's currentOrderId to its order; the first order still has tableId 7 but is no longer the table's current order and disappears from the Tables card.

- **Automation logs, stats and customer prefs are readable/writable by any session** — `server/routes.ts:3755` (R13)  
  A staff PIN session downloads 2,000 customer phone numbers with message history, or flips a customer's doNotSend/mutedUntil.

- **POST /api/crm/segment/batch is shadowed by POST /api/crm/segment/:key (registered first)** — `server/routes.ts:4033` (R13)  
  An admin calls the batch segmentation endpoint: it runs runSegmentationForCustomer('batch','batch') (possibly creating a bogus customer) and returns ok, while no customer is actually re-segmented.

- **Attendance report / recompute-shifts default month and /api/attendance/today use UTC dates; roster default week uses the old wrong formula** — `server/routes.ts:4201` (R13)  
  On an Electron host in IST, importing a sheet with dates like '11/04/2026' stores every row on 2026-11-03; at 00:30 IST on the 1st, the Today board shows yesterday's punches.

- **Consolidated e-bill does 3 sequential queries per order, including a full menu read each time** — `server/services/crm/automationRuleEngine.ts:652` (R14)  
  Sending an e-bill for a customer with 8 open tabs makes ~24 serial round trips (8 full menu reads) before the owner's tap returns, several seconds on the shop's ~100 ms RTT path.

- **backfillOrderPhone stamps a phone onto every phone-less order of anyone sharing the same name** — `server/services/crm/customerIdService.ts:130` (R14)  
  Staff add phone 98xxxxxxxx to the customer 'Raj'. Months of other 'Raj' walk-ins' orders, including another Raj's unpaid due tab, now carry that phone. The consolidated e-bill sent to this customer lists another person's outstanding orders and total, and his visit count/VIP status is inflated.

- **Customer message history returns the oldest 50 messages, not the latest** — `server/services/crm/messagingService.ts:278` (R14)  
  For a customer with more than 50 logged messages, GET /api/crm/customers/:key/messages never shows anything recent: the latest settlement/due messages are missing from the history.

- **Co-purchase scoring can never score anything, so 'upsells' are arbitrary (possibly deleted) menu items** — `server/services/crm/recommendationService.ts:142` (R14)  
  The CRM profile suggests random dishes as 'Co-purchased' upsells, including soft-deleted items the restaurant no longer serves.

- **VISIT_MILESTONE event re-logged every hour while a customer sits at 5/10/25/50 visits** — `server/services/crm/segmentationService.ts:150` (R14)  
  A customer with exactly 10 orders gets a new MILESTONE event every hour (24/day) until their next visit, which bloats customer_events and makes the timeline/analytics show repeated milestones.

- **Every settlement runs a regex sequential scan of orders and a full menu_items read** — `server/services/customerAutomationService.ts:205` (R14)  
  Each paid settlement (when automation is enabled) does a full scan of orders plus a full menu read in the background on the shared DB, costing egress and load that grow with history.

- **'Slow movers' are lifetime totals, not today's, and include deleted items** — `server/services/dailyDigestService.ts:109` (R14)  
  An item that sold 0 today but 500 lifetime never appears as a slow mover, while a soft-deleted dish with few lifetime sales is reported to the owner as today's slow mover.

- **One failing person/day group aborts the rest of a punch batch** — `server/services/deviceAttendanceService.ts:104` (R14)  
  A sync batch covering 10 staff hits an error on the 3rd person, and the remaining 7 people's punches for that batch are not recorded until the device data is re-sent.

- **Feedback link is a bare relative path when no base URL is configured** — `server/services/feedbackService.ts:38` (R14)  
  With feedback enabled but no base URL set, every customer receives a non-clickable '/feedback/abc…' link. No ratings can come back, yet the requests are recorded as sent.

- **Feedback delay is measured from order creation, not payment** — `server/services/feedbackService.ts:160` (R14)  
  A table opened at 7:00 pm and settled at 9:30 pm with a 120-minute delay gets the feedback request within a minute of paying, while the guests are still at the table.

- **kot.reprint / bill.reprint audit rows are written fire-and-forget before the response** — `server/services/printDispatch.ts:298` (R15)  
  Staff reprint a bill on Vercel to hand a customer a second copy (a classic leak vector). The response returns, the instance freezes before the audit INSERT round trip completes, and the reprint never appears in KOT & Bill Activity.

- **Cancelled items create a routed printer group even when printCancelledKOT is off, producing an empty ticket** — `server/services/printDispatch.ts:374` (R15)  
  printCancelledKOT off; one delta adds a Chinese dish (Chinese printer) and removes a dosa (South-Indian printer): the South-Indian counter gets a blank KOT with only the header.

- **Mixed routing (some thermal, some non-ESC/POS printers) silently drops the non-ESC/POS printer's KOT ticket but still commits the snapshot** — `server/services/printDispatch.ts:477` (R15)  
  Main kitchen = network thermal printer; 'Beverages' category routed to an office printer. A KOT with a curry and a lassi: the curry ticket prints, the lassi ticket goes nowhere, and only a message string is returned. A retry finds no_delta, so the lassi never reaches the bar.

- **markTableBilled flips order.tableId to 'billed' even when the order is already settled and the table now belongs to another party** — `server/services/printDispatch.ts:527` (R15)  
  Table 4's earlier order was paid and the table reseated with a new running order. Staff reopen the old paid order in POS and tap Bill to reprint it: the new party's running table flips to 'billed' on the Tables page.

- **connect() does not re-check `destroyed` after its awaits, so a reconnect in flight during destroy() creates an orphan socket** — `server/services/whatsapp/baileysDriver.ts:72` (R15)  
  The socket drops and a reconnect is scheduled; the owner taps Connect. startDriver destroys the old driver and starts a new one on the same auth dir while the old connect() finishes and opens a second socket. Two sockets share one WhatsApp session (WhatsApp kicks one as 'replaced', reconnect loop), and inbound messages may be processed twice (the duplicate bot reply only avoided if waMessageId dedup wins).

- **Delivery receipts that arrive before the outbound row is recorded are dropped** — `server/services/whatsapp/deliveryService.ts:41` (R15)  
  Customer's phone is online; WhatsApp delivers and acks in under a second while the queue is still on its 2-4 DB round trips; campaign History shows the message as only 'sent'.

- **Any exception after the 'sending' claim but before the send leaves the job stuck in 'sending' (never sent, blocks re-enqueue)** — `server/services/whatsapp/outboundQueue.ts:121` (R15)  
  A Supabase pooler blip during isSuppressed for a due-bill reminder: the message is never sent, the job sits in 'sending' indefinitely on the always-on host, and later due reminders for that customer+trigger are silently deduped away.

- **Boot counter repair writes the whole cached settings blob without a lock, clobbering concurrent counter increments and settings saves** — `server/settingsStore.ts:267` (R15)  
  A Vercel cold start while orders are being taken, with kotCounter behind the max: another instance issues bill numbers 71 and 72 meanwhile; this write resets billCounter to 70 and the next two orders collide on the UNIQUE order_number.

- **Staff performance counts cancelled orders and ignores write-offs** — `server/staffRoutes.ts:41` (R15)  
  A waiter creates a ₹1,200 order that is then cancelled (wrong table) and a ₹500 order settled short by ₹100. Staff → Sales shows them with 2 orders / ₹1,700 instead of 1 order / ₹400, inflating their ranking.

- **Staff performance date range is UTC/server-local, not the IST business day** — `server/staffRoutes.ts:42` (R15)  
  On Vercel, orders placed between 05:00 and 05:30 IST are attributed to the previous selected day; on the Electron host the 'to' bound cuts at 23:59 IST, so the late-night orders (00:00–05:00 IST) of the last selected business day are dropped from that staff member's revenue.

- **getStaffTableReport groups by Postgres DATE(created_at) (UTC), not the business day** — `server/storage.ts:970` (R16)  
  An order opened at 05:15 IST on 5 Nov appears under 4 Nov in Reports → Staff & Tables, so that day's per-staff revenue differs from the Sales tab.

- **getDashboardStats runs 6 independent queries serially, including an all-time revenue scan, on a 15 s poll** — `server/storage.ts:1465` (R16)  
  On the shop's high-RTT link, every Live View refresh takes 0.5 s or more of server time where about 0.1 s would do, and holds a pool connection for the whole time. Under concurrent taps this competes with save/print requests for the 10-connection pool.

- **getTodayAttendance uses the UTC date, so the live attendance board shows the wrong day for the first 5.5 hours of each IST day** — `server/storage.ts:1794` (R16)  
  A staff member punches in at 00:30 IST after midnight. The Staff page's LiveAttendanceBoard (GET /api/attendance/today) still shows yesterday's rows ('done' for everyone who worked yesterday) and never shows the new punch until 05:30 IST.

- **replaceAutoShiftSessions (and upsertAttendance*) are unguarded delete-then-insert / check-then-insert** — `server/storage.ts:1981` (R16)  
  The admin clicks Recompute for the month while the K30 agent flushes punches. Today's Morning shift appears twice in the roster, and getPayrollReport counts two 'present' attendance rows for that day.

- **Global console.error override can throw (circular/BigInt args) and loses Error messages in the log buffer** — `server/vite.ts:17` (R16)  
  A catch block runs console.error('[x] failed:', err) where err carries a circular reference (e.g. an http ClientRequest error from a webhook/driver call). A TypeError 'Converting circular structure to JSON' is thrown from the logging line, the route never responds and the request hangs until the client times out. Admin log views show '{}' for every real error.

- **Agent-inbox reply/takeover/return-to-bot are requireAuth: a bare staff session can send arbitrary outbound WhatsApp messages** — `server/whatsappRoutes.ts:127` (R16)  
  A staff PIN session loops over POST /api/whatsapp/conversations/1..N/reply {message:'...'}. Every customer thread receives the text from the restaurant's number, and only the realtime feed records who sent it. A burst like this is the ban scenario CLAUDE.md warns about.

- **diffOrderLines keys last-wins per menuItemId:size, so adding or removing a duplicate line of the same dish/mode is invisible in the audit** — `shared/orderAudit.ts:67` (R16)  
  A waiter removes the '+ Extra Butter' Naan line, keeping the plain one at the same quantity. The order.items_edit row shows only a total change and no removed item, and KOT & Bill Activity does not count it as KOT Modified.

- **mergeDuplicateItems drops the add-on/variant text of every merged line but the first** — `shared/print/generators.ts:264` (R17)  
  Two Margherita (Regular) lines, one '+ Extra Cheese' (₹40 more), one plain, with mergeDuplicateItems on: the bill shows '2 x Margherita' at an averaged price with only the first line's addon note (or none), so the customer can't see what the extra charge is for.

- **Reprinted bill labels CGST/SGST with the CURRENT tax rate, not the order's** — `shared/print/generators.ts:314` (R17)  
  Settings tax rate is changed from 18% to 5%; a customer asks for a reprint of yesterday's ₹1,000 bill: it shows CGST 2.5% / SGST 2.5% with ₹90 each.

- **drainResponses always matches PRINT_OK before PRINT_FAIL regardless of their order in the buffer** — `shared/print/persistentPs.ts:105` (R17)  
  Category routing queues two tickets on one Electron host in quick succession: job 1 to an offline/unplugged counter printer (WritePrinter returns false -> 'PRINT_FAIL:...'), job 2 to the working kitchen printer ('PRINT_OK'). Both lines land in one chunk. Job 1 resolves as printed (its print_jobs row is acked, the ticket is lost with no retry/release), job 2 is rejected, falls back to sendRawLegacy and prints a second time on the kitchen printer.

- **No 'error' listener on the PowerShell stdin stream** — `shared/print/persistentPs.ts:234` (R17)  
  Antivirus kills powershell.exe at the moment a KOT is sent; the stdin write emits EPIPE, the unhandled stream error becomes an uncaughtException in the desktop host instead of a rejected print that falls back.

- **resolveWindowsQueueForPrinter falls back to the first installed queue of any kind** — `shared/print/windowsPrinters.ts:176` (R17)  
  A USB thermal printer configured by VID/PID only is unplugged (or its driver queue was removed) on a PC that also has an HP LaserJet on a network port. Each KOT is sent RAW to the LaserJet: garbage/blank pages print, WritePrinter succeeds, the job is acked as printed, and the kitchen never receives the ticket.

- **Any fast-path error (incl. the 30s timeout) falls back to sendRawLegacy, which can print the ticket twice** — `shared/print/windowsRawPrint.ts:90` (R17)  
  The Windows spooler stalls for 35 s on a KOT (printer busy/paper-out recovered). sendRawFast times out at 30 s and rejects; the caller immediately spawns a legacy PowerShell which queues the same bytes; when the spooler recovers both jobs print — the kitchen gets a duplicate KOT and cooks the order twice.

- **Any resource entry whose pathname is /api/orders (e.g. a GET poll with ?open=true) is classified as the settle's 'orders' leg, and entries after finishedAt are not excluded** — `shared/settleTiming.ts:63` (R18)  
  Saved-order settle takes 11 s; a realtime-triggered GET /api/orders?open=true fires during the wait. It becomes legs[0]/beforePayment, so startLagMs, betweenLegsMs and possibly slowestLeg in the perf.slow_settle audit row describe the poll instead of the PUT /items save, misdirecting the latency investigation.

- **shortfallAmount is non-zero for rounding differences inside SETTLE_TOLERANCE, contradicting 'treated as fully settled, NOT as a write-off'** — `shared/settlement.ts:86` (R18)  
  Bill ₹773.40 paid ₹773 cash: no write-off confirm/PIN/audit (isShort false), yet the order stores shortfall_amount 0.40; over a day of such bills Reports shows a non-zero 'written off' figure that matches no write-off event in KOT & Bill Activity.
