/**
 * Settle a Due (a customer paying their open tab) from the Orders page: Cash, UPI or a Cash+UPI
 * split — the same settlement box POS uses, minus its "Due" button (this order already IS a due).
 *
 * Flow: fill the box → "Settle Now" (or the write-off confirm when short) → a manager/admin PIN pad →
 * POST /api/orders/:id/settle-due. The PIN is asked for EVERY time, whoever is logged in; the server
 * enforces it independently (requireFreshPin), so skipping this client step gets a 403, not a settle.
 *
 * All the money maths is shared/settlement.ts's resolveSettlement (inside SettlementDialog) and, on the
 * server, shared/dueSettlement.ts's planDueSettlement — the client never sends a computed total, only
 * what the customer handed over, and the server recomputes paid / change / shortfall from its own bill.
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { SettlementDialog, type SettlementData, type SettlementItem } from "@/components/SettlementDialog";
import { PinGuard } from "@/components/PinGuard";
import { apiRequest } from "@/lib/queryClient";
import { describeApiError } from "@/lib/apiError";
import { toast } from "@/hooks/use-toast";
import { serialNum } from "@/lib/orderDisplay";
import { deriveBillTotals } from "@shared/orderPricing";

interface Props {
  order: any;
  /** Itemised lines when the order detail is already loaded — optional, purely for the summary block. */
  items?: SettlementItem[];
  onClose: () => void;
}

type Pending = { payments: SettlementData["payments"]; allowShortfall: boolean };

export function DueSettleDialog({ order, items, onClose }: Props) {
  // The provider's client, not the module-level singleton: in Vite dev the module can be served under two
  // URLs (see App.tsx's Router) and invalidating the wrong instance leaves the list stale after a settle.
  const queryClient = useQueryClient();
  // "form" → the settlement box; "pin" → PIN pad over it; "saving" → request in flight.
  const [stage, setStage] = useState<"form" | "pin" | "saving">("form");
  const [pending, setPending] = useState<Pending | null>(null);

  const total = parseFloat(order.totalAmount ?? "0");
  const bill = deriveBillTotals(order);

  const mutation = useMutation({
    mutationFn: async (p: Pending) => {
      const res = await apiRequest("POST", `/api/orders/${order.id}/settle-due`, {
        payments: p.payments,
        allowShortfall: p.allowShortfall,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Due settled", description: `${serialNum(order.id)} is now paid.` });
      // One prefix match covers the list AND this order's own detail (["/api/orders", id]).
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/live-status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      // Reports → Payments (collected today, the open-tabs list) and the owner's activity list all move.
      queryClient.invalidateQueries({ predicate: q => String(q.queryKey[0] ?? "").indexOf("/api/reports/") === 0 });
      onClose();
    },
    onError: (err: unknown) => {
      const info = describeApiError(err);
      toast({
        title: info.code === "PIN_REQUIRED" ? "PIN needed" : "Could not settle the due",
        description: info.code === "PIN_REQUIRED" ? "The PIN check expired — settle again and re-enter the PIN." : info.message,
        variant: "destructive",
      });
      // Back to the form with everything still filled in, so a retry is one tap.
      setStage("form");
    },
  });

  return (
    <>
      <SettlementDialog
        open
        onOpenChange={(v) => { if (!v && stage === "form") onClose(); }}
        title={`Settle Due · ${serialNum(order.id)} · ₹${Math.round(total)}`}
        grandTotal={total}
        hideDueMode
        lockClose={stage !== "form"}
        isLoading={stage === "saving"}
        items={items}
        subtotal={bill.subtotal}
        taxAmount={bill.tax}
        discountAmount={bill.discount}
        orderLabel={serialNum(order.id)}
        initialCustomerName={order.customerName ?? undefined}
        initialCustomerPhone={order.customerPhone ?? undefined}
        onSettle={(d) => {
          // The box has already done its own "short by ₹X — confirm the write-off" step by now.
          setPending({ payments: d.payments, allowShortfall: d.allowShortfall });
          (document.activeElement as HTMLElement | null)?.blur?.();
          setStage("pin");
        }}
      />

      {stage === "pin" && pending && (
        <PinGuard
          actionLabel={`Settle due ${serialNum(order.id)}${order.customerName ? ` · ${order.customerName}` : ""}`}
          requiredRole="manager"
          onSuccess={() => { setStage("saving"); mutation.mutate(pending); }}
          onCancel={() => setStage("form")}
        />
      )}
    </>
  );
}
