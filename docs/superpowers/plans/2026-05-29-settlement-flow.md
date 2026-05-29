# Settlement & Split-Payment Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the one-tap settle with a Petpooja-style flow: KOT → Bill (sets table to Billed) → Settlement dialog (split Cash/UPI/Card with live balance) → table freed.

**Architecture:** 4 targeted changes — schema adds 3 payment fields, server gets a new bill-requested endpoint + enhanced payment endpoint, a new isolated `SettlementDialog` component handles all payment UI, and POS.tsx wires it together with 5 small edits.

**Tech Stack:** Drizzle ORM, Express, React, TanStack Query, shadcn/ui Dialog + Input + Button, Lucide icons

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `shared/schema.ts` | Modify | Add `paidAmount`, `changeAmount`, `paymentBreakdown` to orders table |
| `server/routes.ts` | Modify | Add `POST /api/orders/:id/bill-requested`; enhance `POST /api/orders/:id/payment` |
| `client/src/components/SettlementDialog.tsx` | Create | Full split-payment dialog — all payment UI lives here |
| `client/src/pages/POS.tsx` | Modify | Wire dialog; rename Print→Bill; remove old payment buttons |

---

## Task 1: Add payment fields to schema

**Files:**
- Modify: `shared/schema.ts` (orders table, ~line 69)

- [ ] **Step 1: Add 3 fields to the orders table**

In `shared/schema.ts`, find the `notes` field inside the `orders` pgTable and add the 3 new fields immediately after it:

```typescript
  notes: text("notes"),
  paidAmount: decimal("paid_amount", { precision: 10, scale: 2 }),
  changeAmount: decimal("change_amount", { precision: 10, scale: 2 }),
  paymentBreakdown: json("payment_breakdown").$type<Record<string, number>>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
```

- [ ] **Step 2: Push schema to database**

```bash
npm run db:push
```

Expected: `Your schema is now in sync` (or similar Drizzle success message). If it asks to confirm column additions, type `y`.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npm run check
```

Expected: No errors relating to the new fields.

- [ ] **Step 4: Commit**

```bash
git add shared/schema.ts
git commit -m "feat: add paidAmount, changeAmount, paymentBreakdown to orders schema"
```

---

## Task 2: Server — bill-requested endpoint

**Files:**
- Modify: `server/routes.ts` (add after the existing hold endpoint, around line 1660)

- [ ] **Step 1: Add the bill-requested endpoint**

In `server/routes.ts`, find `app.put("/api/orders/:id/hold"` and add the new endpoint directly before it:

```typescript
  // ── Bill requested — set table to "billed" when staff prints customer bill ───
  app.post("/api/orders/:id/bill-requested", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const order = await storage.getOrderById(id);
      if (!order) return res.status(404).json({ error: "Order not found" });
      if ((order as any).tableId) {
        // Set table status to "billed" — keeps currentOrderId unchanged
        await storage.updateTableStatus(Number((order as any).tableId), "billed");
        broadcast({ type: "TABLE_UPDATE" });
      }
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to update table status" });
    }
  });
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run check
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add server/routes.ts
git commit -m "feat: add bill-requested endpoint to set table billed status"
```

---

## Task 3: Server — enhance payment endpoint

**Files:**
- Modify: `server/routes.ts` — replace body of `POST /api/orders/:id/payment` (lines 1535–1582)

- [ ] **Step 1: Replace the payment endpoint body**

Find `app.post("/api/orders/:id/payment"` in `server/routes.ts`. Replace the entire function body (everything between the opening `try {` and closing `} catch`) with:

```typescript
    const id = parseInt(req.params.id);
    const {
      paymentMethod,
      payments,
      totalPaid,
      changeAmount: changeAmt,
      notes,
      isDue: explicitDue,
      customerName,
      customerPhone,
    } = req.body;

    const isDue = explicitDue || paymentMethod === "due";

    let breakdown: Record<string, number> = {};
    let primaryMethod = "cash";
    let paidAmt = 0;
    let changeDue = 0;

    if (payments && Array.isArray(payments)) {
      // Rich split-payment path
      for (const p of payments) {
        if (Number(p.amount) > 0) {
          breakdown[p.method] = (breakdown[p.method] || 0) + Number(p.amount);
        }
      }
      paidAmt = totalPaid != null ? Number(totalPaid) : Object.values(breakdown).reduce((a, b) => a + b, 0);
      changeDue = changeAmt != null ? Number(changeAmt) : 0;
      const sorted = Object.entries(breakdown).sort((a, b) => b[1] - a[1]);
      primaryMethod = sorted[0]?.[0] ?? "cash";
    } else {
      // Legacy single-method path (backward-compatible)
      primaryMethod = paymentMethod || "cash";
      const existingOrder = await storage.getOrderById(id);
      paidAmt = parseFloat(String((existingOrder as any)?.totalAmount ?? 0));
      breakdown = { [primaryMethod]: paidAmt };
    }

    const updateData: any = {
      paymentMethod: primaryMethod,
      paymentStatus: isDue ? "pending" : "paid",
      status: "served",
      paidAmount: String(paidAmt),
      changeAmount: String(changeDue),
      paymentBreakdown: breakdown,
    };
    if (notes) updateData.notes = notes;
    if (customerName) updateData.customerName = customerName;
    if (customerPhone) updateData.customerPhone = customerPhone;

    const order = await storage.updateOrder(id, updateData);

    if ((order as any).tableId) {
      await storage.updateTableStatus(Number((order as any).tableId), "free", null);
      broadcast({ type: "TABLE_UPDATE" });
    }
    broadcast({ type: "ORDER_UPDATE", order });

    logAudit(req, "order.payment", "order", id, {
      paymentMethod: primaryMethod,
      paymentStatus: isDue ? "pending" : "paid",
      paidAmount: paidAmt,
      changeAmount: changeDue,
      paymentBreakdown: breakdown,
    });

    if (!isDue) {
      const key = (order as any).customerPhone?.trim() || (order as any).customerName?.trim();
      if (key) {
        earnPointsForOrder(
          key,
          (order as any).customerName ?? key,
          id,
          parseFloat(String((order as any).totalAmount ?? 0)),
        ).catch((e: any) => console.warn("[Loyalty] earn failed:", e));
      }
      scheduleFeedbackForOrder(id).catch((e: any) => console.warn("[Feedback] schedule failed:", e));
    }

    res.json(order);
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run check
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add server/routes.ts
git commit -m "feat: enhance payment endpoint to support split payments and change/balance tracking"
```

---

## Task 4: Create SettlementDialog component

**Files:**
- Create: `client/src/components/SettlementDialog.tsx`

- [ ] **Step 1: Create the file**

```typescript
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface SettlementPayment {
  method: "cash" | "upi" | "card";
  amount: number;
}

export interface SettlementData {
  payments: SettlementPayment[];
  totalPaid: number;
  changeAmount: number;
  isDue: boolean;
  customerName?: string;
  customerPhone?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  grandTotal: number;
  onSettle: (data: SettlementData) => void;
  onPrintBill: () => void;
  isLoading?: boolean;
}

const METHODS: { key: "cash" | "upi" | "card"; label: string; icon: string }[] = [
  { key: "cash",  label: "Cash", icon: "💵" },
  { key: "upi",   label: "UPI",  icon: "📱" },
  { key: "card",  label: "Card", icon: "💳" },
];

export function SettlementDialog({ open, onOpenChange, grandTotal, onSettle, onPrintBill, isLoading }: Props) {
  const [cash,  setCash]  = useState(0);
  const [upi,   setUpi]   = useState(0);
  const [card,  setCard]  = useState(0);
  const [isDue, setIsDue] = useState(false);
  const [customerName,  setCustomerName]  = useState("");
  const [customerPhone, setCustomerPhone] = useState("");

  const totalEntered = cash + upi + card;
  const remaining    = grandTotal - totalEntered;
  const changeDue    = remaining < 0 ? Math.abs(remaining) : 0;
  const balanceDue   = remaining > 0 ? remaining : 0;
  const canSettle    = isDue || totalEntered >= grandTotal;

  const amounts: Record<"cash" | "upi" | "card", number> = { cash, upi, card };
  const setters: Record<"cash" | "upi" | "card", (v: number) => void> = {
    cash: setCash, upi: setUpi, card: setCard,
  };

  // Running balance per row — counts down as each method is filled
  const rowRemaining: number[] = [];
  let balance = grandTotal;
  for (const m of METHODS) {
    balance = Math.max(0, balance - amounts[m.key]);
    rowRemaining.push(balance);
  }

  const parse = (v: string) => Math.max(0, parseFloat(v) || 0);

  const handleSettle = () => {
    const payments: SettlementPayment[] = METHODS
      .filter(m => amounts[m.key] > 0)
      .map(m => ({ method: m.key, amount: amounts[m.key] }));
    onSettle({
      payments,
      totalPaid: totalEntered,
      changeAmount: changeDue,
      isDue,
      customerName:  isDue ? customerName  : undefined,
      customerPhone: isDue ? customerPhone : undefined,
    });
  };

  // Reset state when dialog closes
  const handleOpenChange = (v: boolean) => {
    if (!v) {
      setCash(0); setUpi(0); setCard(0);
      setIsDue(false); setCustomerName(""); setCustomerPhone("");
    }
    onOpenChange(v);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Collect Payment · ₹{grandTotal.toFixed(0)}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {/* Payment table */}
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground border-b">
                <th className="text-left pb-2 font-medium">Method</th>
                <th className="text-right pb-2 font-medium pr-2">Amount (₹)</th>
                <th className="text-right pb-2 font-medium w-20">Remaining</th>
              </tr>
            </thead>
            <tbody>
              {METHODS.map((m, i) => (
                <tr key={m.key} className="border-b last:border-0">
                  <td className="py-2 font-medium text-sm">{m.icon} {m.label}</td>
                  <td className="py-2 text-right pr-2">
                    <Input
                      type="number"
                      min={0}
                      value={amounts[m.key] || ""}
                      onChange={e => setters[m.key](parse(e.target.value))}
                      placeholder="0"
                      className="w-28 text-right h-8 text-sm ml-auto"
                    />
                  </td>
                  <td className={`py-2 text-right font-semibold text-sm ${
                    rowRemaining[i] > 0 ? "text-red-600" : "text-green-600"
                  }`}>
                    ₹{rowRemaining[i].toFixed(0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Summary bar */}
          <div className={`rounded-lg px-3 py-2 text-sm flex justify-between items-center ${
            balanceDue > 0
              ? "bg-red-50 text-red-700"
              : changeDue > 0
              ? "bg-blue-50 text-blue-700"
              : "bg-green-50 text-green-700"
          }`}>
            <span>Total entered <strong>₹{totalEntered.toFixed(0)}</strong></span>
            <span className="font-bold">
              {balanceDue > 0
                ? `Balance due ₹${balanceDue.toFixed(0)}`
                : changeDue > 0
                ? `Change ₹${changeDue.toFixed(0)}`
                : "✓ Settled"}
            </span>
          </div>

          {/* Mark Due toggle */}
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={isDue}
              onChange={e => setIsDue(e.target.checked)}
              className="accent-amber-500 w-4 h-4"
            />
            <span className="text-sm font-medium text-amber-700">
              Mark as Due (customer pays later)
            </span>
          </label>

          {/* Customer details — only shown when Mark Due is checked */}
          {isDue && (
            <div className="space-y-2 p-3 bg-amber-50 rounded-lg border border-amber-200">
              <p className="text-xs text-amber-700 font-medium">
                Customer details for due tracking:
              </p>
              <Input
                placeholder="Customer name"
                value={customerName}
                onChange={e => setCustomerName(e.target.value)}
                className="h-8 text-sm"
              />
              <Input
                placeholder="Phone number"
                value={customerPhone}
                onChange={e => setCustomerPhone(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              onClick={onPrintBill}
              className="flex-1 text-xs"
            >
              🖨 Print Bill
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleOpenChange(false)}
              className="flex-1 text-xs"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSettle}
              disabled={!canSettle || isLoading}
              className="flex-[2] bg-green-600 hover:bg-green-700 text-white text-xs font-bold"
            >
              {isLoading ? "Settling…" : "✓ Settle Now"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run check
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/SettlementDialog.tsx
git commit -m "feat: add SettlementDialog with split payment, balance tracking, and Mark Due flow"
```

---

## Task 5: Wire POS.tsx — 5 targeted edits

**Files:**
- Modify: `client/src/pages/POS.tsx`

### Edit 5a — Add import + state + refs

- [ ] **Step 1: Add SettlementDialog import**

Find the existing imports block at the top of `client/src/pages/POS.tsx`. Add after the `import { serialNum }` line:

```typescript
import { SettlementDialog, type SettlementData } from "@/components/SettlementDialog";
```

- [ ] **Step 2: Add showSettleDialog state and settlementDataRef**

Find the block of state declarations around line 161 (near `selectedPaymentMethod`). Add directly after `const [isPaid, setIsPaid] = useState(false);`:

```typescript
  const [showSettleDialog, setShowSettleDialog] = useState(false);
  const settlementDataRef = useRef<SettlementData | null>(null);
```

### Edit 5b — Update settleMutation to send rich payment data

- [ ] **Step 3: Replace settleMutation mutationFn signature and body** (lines 716–719)

Replace:
```typescript
  const settleMutation = useMutation({
    mutationFn: async ({ orderId, paymentMethod, notes }: { orderId: number; paymentMethod: string; order?: any; notes?: string }) => {
      const res = await apiRequest("POST", `/api/orders/${orderId}/payment`, { paymentMethod, notes });
      return res.json();
    },
```

With:
```typescript
  const settleMutation = useMutation({
    mutationFn: async ({ orderId, paymentMethod, notes, payments, totalPaid, changeAmount, isDue, customerName, customerPhone }: {
      orderId: number;
      order?: any;
      paymentMethod?: string;
      notes?: string;
      payments?: { method: string; amount: number }[];
      totalPaid?: number;
      changeAmount?: number;
      isDue?: boolean;
      customerName?: string;
      customerPhone?: string;
    }) => {
      const body = payments
        ? { payments, totalPaid, changeAmount, isDue, customerName, customerPhone }
        : { paymentMethod: paymentMethod || "cash", notes };
      const res = await apiRequest("POST", `/api/orders/${orderId}/payment`, body);
      return res.json();
    },
```

### Edit 5c — Update the two settleMutation.mutate() call sites to pass settlementDataRef

- [ ] **Step 4: Update first mutate call** (in createOrderMutation onSuccess, ~line 663)

Replace:
```typescript
        settleMutation.mutate({ orderId: order.id, order, paymentMethod: paymentMethodRef.current, notes: paymentMethodRef.current === "other" ? otherReasonRef.current : undefined });
```

With:
```typescript
        const sd = settlementDataRef.current;
        settleMutation.mutate(sd
          ? { orderId: order.id, order, ...sd }
          : { orderId: order.id, order, paymentMethod: paymentMethodRef.current, notes: paymentMethodRef.current === "other" ? otherReasonRef.current : undefined }
        );
```

- [ ] **Step 5: Update second mutate call** (in updateOrderMutation onSuccess, ~line 706)

Replace:
```typescript
        settleMutation.mutate({ orderId: vars.orderId, order, paymentMethod: paymentMethodRef.current, notes: paymentMethodRef.current === "other" ? otherReasonRef.current : undefined });
```

With:
```typescript
        const sd = settlementDataRef.current;
        settleMutation.mutate(sd
          ? { orderId: vars.orderId, order, ...sd }
          : { orderId: vars.orderId, order, paymentMethod: paymentMethodRef.current, notes: paymentMethodRef.current === "other" ? otherReasonRef.current : undefined }
        );
```

### Edit 5d — Change handleSettle + handleKOTAndPrint + add handleBillPrint

- [ ] **Step 6: Replace the three handler definitions** (~lines 924–926)

Find:
```typescript
  const handleKOT        = () => { capturePreKOTItems(); submitModeRef.current = "kot";        triggerSubmit(); };
  const handleKOTAndPrint= () => { capturePreKOTItems(); submitModeRef.current = "kot-print";  triggerSubmit(); };
  const handleSettle     = () => { setSettlePhase("processing"); submitModeRef.current = "settle"; triggerSubmit(); };
```

Replace with:
```typescript
  const handleKOT     = () => { capturePreKOTItems(); submitModeRef.current = "kot"; triggerSubmit(); };
  const handleSettle  = () => { if (hasItems) setShowSettleDialog(true); };
  const handleBillPrint = async () => {
    if (!activeOrderId) return;
    triggerBillPrint(activeOrderId, existingOrder);
    try {
      await apiRequest("POST", `/api/orders/${activeOrderId}/bill-requested`, {});
      queryClient.invalidateQueries({ queryKey: ["/api/tables"] });
    } catch {
      // non-critical — bill is printed even if status update fails
    }
  };
```

### Edit 5e — Replace cart bottom-panel UI

- [ ] **Step 7: Remove payment method buttons section** (lines 2101–2143)

Find and delete the entire block from `{/* Payment method */}` through the closing `</div>` of the "It's Paid" label. This is the section:
```typescript
          {/* Payment method */}
          <div className="px-2 py-2 border-t shrink-0">
            ...
            {/* It's Paid */}
            <label ...>
              ...
            </label>
          </div>
```

Replace the entire deleted block with the SettlementDialog mount (place it just before the `{/* Action buttons */}` div):
```tsx
          <SettlementDialog
            open={showSettleDialog}
            onOpenChange={setShowSettleDialog}
            grandTotal={grandTotal}
            isLoading={settleMutation.isPending}
            onPrintBill={() => activeOrderId && triggerBillPrint(activeOrderId, existingOrder)}
            onSettle={(data) => {
              settlementDataRef.current = data;
              setShowSettleDialog(false);
              setSettlePhase("processing");
              submitModeRef.current = "settle";
              triggerSubmit();
            }}
          />
```

- [ ] **Step 8: Replace the KOT/Print row buttons** (~lines 2168–2185)

Find:
```tsx
            {/* KOT row */}
            <div className="grid grid-cols-2 gap-1">
              <button
                disabled={!hasItems || isPending}
                onClick={handleKOT}
                className="py-1.5 rounded text-[10px] font-semibold border border-orange-300 text-orange-600 bg-orange-50 hover:bg-orange-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                KOT
              </button>
              <button
                disabled={!hasItems || isPending}
                onClick={handleKOTAndPrint}
                className="py-1.5 rounded text-[10px] font-semibold border border-orange-300 text-orange-600 bg-orange-50 hover:bg-orange-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1"
              >
                <Printer className="w-3 h-3" />
                Print
              </button>
            </div>
```

Replace with:
```tsx
            {/* KOT / Bill row */}
            <div className="grid grid-cols-2 gap-1">
              <button
                disabled={!hasItems || isPending}
                onClick={handleKOT}
                className="py-1.5 rounded text-[10px] font-semibold border border-orange-300 text-orange-600 bg-orange-50 hover:bg-orange-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                KOT
              </button>
              <button
                disabled={!activeOrderId || isPending}
                onClick={handleBillPrint}
                className="py-1.5 rounded text-[10px] font-semibold border border-blue-300 text-blue-600 bg-blue-50 hover:bg-blue-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1"
              >
                <Printer className="w-3 h-3" />
                Bill
              </button>
            </div>
```

- [ ] **Step 9: Verify TypeScript compiles**

```bash
npm run check
```

Expected: No type errors. If `handleKOTAndPrint` is referenced anywhere else, remove those references too (search for `handleKOTAndPrint` in POS.tsx).

- [ ] **Step 10: Commit**

```bash
git add client/src/pages/POS.tsx
git commit -m "feat: wire settlement dialog, rename Print to Bill, remove legacy payment buttons"
```

---

## Task 6: End-to-end verification

- [ ] **Step 1: Start dev server**

```bash
npm run dev
```

- [ ] **Step 2: Verify Bill button sets table to Billed**

1. Open POS, select a table, add items
2. Click **KOT** → kitchen receives order, table stays Running (yellow) on live view
3. Click **Bill** → bill prints (or preview shows), table card turns red **"Billing"** on live view

- [ ] **Step 3: Verify split-payment settlement**

1. Click **Settle** → SettlementDialog opens showing grand total
2. Enter ₹500 in Cash on a ₹1,025 bill → Remaining column shows ₹525 in red, "Balance due ₹525" in summary, Settle Now disabled
3. Enter ₹525 in UPI → all remaining show ₹0 in green, "✓ Settled" in summary, Settle Now enabled
4. Click **✓ Settle Now** → table freed (green Idle on live view), order shows as "served" in Orders page

- [ ] **Step 4: Verify overpayment**

1. Open a fresh order, click Settle
2. Enter ₹1,030 Cash on ₹1,025 bill → "Change ₹5" shown in blue summary bar
3. Settle → completes successfully

- [ ] **Step 5: Verify Mark Due**

1. Open a fresh order, click Settle → check **Mark as Due**
2. Enter customer name + phone → click **✓ Settle Now**
3. Table goes free immediately
4. Open Billing page → order appears in Due Orders with customer name, phone, items, amount, timestamp

- [ ] **Step 6: Verify KOT unchanged**

1. Add items, click **KOT** → KOT prints, POS stays open, no table status change

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "feat: complete settlement flow — split payments, bill status, due tracking"
```
