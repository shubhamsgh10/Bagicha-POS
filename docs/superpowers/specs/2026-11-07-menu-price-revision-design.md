# Menu price revision (owner's PDF, Nov 2026) — design

**Source:** the owner's final price list, "Price Comparison of zomato + menu 2.pdf" (192 rows, column
"Revised menu Price"). Transcribed verbatim into `scripts/data/menu-prices-2026-11.ts` (`PDF_ROWS`).

## Goal
Every PDF price becomes the live price in `menu_items` (the one shared production DB), in one
transaction, with nothing else on the menu disturbed.

## Decisions (confirmed with the user, 7 Nov 2026)
- **Existing dishes:** re-priced in place (base `price`; for the six pizzas also every `sizes[].price`,
  keeping each size's `stockMultiplier`; base price = the Small price, as today).
- **"Chilly (Paneer/Baby Corn/Mushroom/Honey Potato)"** and **"Tikka (Paneer/Baby Corn/Mushroom/Potato)"**
  each set all four existing menu items.
- **Spaghetti is split by sauce:** item #26 "Spaghetti" is renamed "Alfredo Spaghetti Pasta" (₹349, keeps
  its order history); Arrabiata and Pesto Spaghetti are new items at ₹399.
- **Rolls stay one item each:** "Veg Roll" ₹249 (PDF Aloo/Mushroom Veg Roll), "Egg Roll" ₹299 (PDF Egg
  Mushroom/Noodles/Vegetable Roll).
- **15 new dishes** go into existing categories: Pasta (Pesto Penne Fettuccine, Arrabiata Spaghetti, Pesto
  Spaghetti), Combos (Chole Bhature), Main Course (Daliya, Stuffed Tamatar, Stuffed Capsicum), Munchies
  (Dal Pakwan, Pav, Aloo Tikki Chaat), Indian Bread (Butter Tandoori Naan), Rice & Spice (Veg Biryani),
  Wok Style (Egg Noodles, Egg Fried Rice), Eggs (Pesto Sunrise Toast). DB defaults otherwise (available,
  15 min, notes allowed, no add-ons) — same as Admin → Menu.
- **PDF prices are used exactly**, including Wild Fire Large ₹599 and Soda ₹99 (flagged as possible typos;
  the user chose "as written").
- **Not changed:** names (except #26), categories (the PDF's category column is a different scheme), the 7
  active dishes absent from the PDF (Veg Butter Masala, Veg Haryali, Veg Hyderabadi, Veg Kofta, Veg Navratan,
  Greart Peas Pulao, Bahubali Masala Dosa), add-on prices.

## Mechanism
- `scripts/lib/menuPricePlan.ts` — pure planner. Input: live menu rows + categories + the target table.
  Output: the list of updates/inserts, the already-correct ids, and errors. Every update is keyed on
  **id + expected current name** (or the rename target, so a re-run is a no-op); a deleted row, a name
  mismatch, an unexpected size list, an invalid price (`shared/menuValidation.ts`) or a new dish whose name
  already exists at a different price is an error, and any error aborts the run. `checkCoverage` proves
  every PDF row 1–192 is used by a target and that each target's price equals its PDF row(s).
- `scripts/apply-menu-prices-2026-11.ts` — dry run by default (prints the diff). `--confirm`: refuses while
  any order is open (pending/preparing/ready/hold, unpaid) unless `--allow-open`; snapshots `menu_items` +
  `categories` to `backups/`; one transaction that re-reads the rows `FOR UPDATE`, re-plans, and writes each
  update with `WHERE id = $1 AND name = $2` (row count must be 1); then publishes `MENU_UPDATE` so open POS
  screens refetch the menu. Uses one connection, `BEGIN`/`COMMIT` only — no session `SET` (transaction pooler).

## Why "no open orders"
`priceOrder` pulls a line below the menu floor up to it, so a running table re-saved after the update would
be re-billed at the new (higher) price mid-meal; a price cut would not reach lines already in an open order.

## Verification
`scripts/verify-menu-price-plan.ts` (DB-free) locks the planner and the real data's coverage. After the
write: re-run the dry run (expect 0 changes) and compare the live menu against every PDF row.
