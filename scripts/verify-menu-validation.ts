/** Verifies shared/menuValidation.ts. Run: npx tsx scripts/verify-menu-validation.ts */
import { menuPriceError, menuSizesError } from "../shared/menuValidation";
const checks: Array<[string, boolean]> = [];
checks.push(["120 ok", menuPriceError("120") === null]);
checks.push(["99.50 ok", menuPriceError("99.50") === null]);
checks.push(["number 45 ok", menuPriceError(45) === null]);
checks.push(["0 ok (size-priced)", menuPriceError("0") === null]);
checks.push(["abc rejected", menuPriceError("abc") !== null]);
checks.push(["-50 rejected", menuPriceError("-50") !== null]);
checks.push(["1e9 rejected", menuPriceError("1e9") !== null]);
checks.push(["blank rejected", menuPriceError("") !== null]);
checks.push(["3 decimals rejected", menuPriceError("1.005") !== null]);
checks.push(["over max rejected", menuPriceError("100001") !== null]);
checks.push(["no sizes ok", menuSizesError(null) === null && menuSizesError(undefined) === null]);
checks.push(["valid sizes ok", menuSizesError([{ size: "Regular", price: 120 }, { size: "Large", price: "180" }]) === null]);
checks.push(["size price 0 rejected", menuSizesError([{ size: "Regular", price: 0 }]) !== null]);
checks.push(["size without name rejected", menuSizesError([{ size: " ", price: 10 }]) !== null]);
checks.push(["non-array rejected", menuSizesError("x") !== null]);
let failed = 0;
for (const [n, ok] of checks) { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); if (!ok) failed++; }
console.log(failed === 0 ? "\nRESULT: PASS ✅" : `\nRESULT: FAIL ❌ (${failed})`);
process.exit(failed === 0 ? 0 : 1);
