import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiJson } from "@/lib/api";
import { apiRequest } from "@/lib/queryClient";
import { describeApiError } from "@/lib/apiError";
import { useRole } from "@/hooks/useRole";
import { useLocalSync } from "@/hooks/useLocalSync";
import { toast } from "@/hooks/use-toast";
import { PinGuard } from "@/components/PinGuard";
import { lockedDialogProps } from "@/lib/dialogLock";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface Problem {
  seq: number;
  orderId: number | null;
  method: string;
  path: string;
  lastError: string | null;
  lastCode: string | null;
  createdAt: string;
}

/** A plain-words name for a queued request. */
export function describeAction(method: string, path: string): string {
  const m = method.toUpperCase();
  if (m === "POST" && path === "/api/orders") return "New order";
  if (/\/items$/.test(path)) return "Edit items";
  if (/\/payment-method$/.test(path)) return "Payment method change";
  if (/\/settle-due$/.test(path)) return "Settle due";
  if (/\/payment$/.test(path)) return "Settle bill";
  if (/\/cancel$/.test(path)) return "Cancel order";
  if (/\/hold$/.test(path)) return "Hold order";
  if (/\/recall$/.test(path)) return "Recall order";
  if (/\/move-table$/.test(path) || /\/shift$/.test(path)) return "Move table";
  if (/\/bill-requested$/.test(path)) return "Bill requested";
  if (path === "/api/print/kot") return "KOT print";
  if (path === "/api/print/bill") return "Bill print";
  if (/^\/api\/kot\//.test(path)) return "Kitchen ticket update";
  if (/^\/api\/orders\/\d+$/.test(path)) return "Order status change";
  return `${m} ${path}`;
}

/** Shop PC only (the route is registered only in local mode). Lists actions the cloud refused. */
export default function SyncProblems() {
  const role = useRole();
  const canDiscard = role === "admin" || role === "manager";
  const qc = useQueryClient();
  const status = useLocalSync();
  const { data: problems = [], isLoading } = useQuery<Problem[]>({
    queryKey: ["/api/local/problems"],
    queryFn: () => apiJson<Problem[]>("/api/local/problems"),
    refetchInterval: 5000,
  });
  const [confirming, setConfirming] = useState<Problem | null>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["/api/local/problems"] });
    qc.invalidateQueries({ queryKey: ["/api/local/status"] });
  };

  const retry = async (p: Problem) => {
    setBusy(p.seq);
    try {
      await apiRequest("POST", `/api/local/problems/${p.seq}/retry`, {});
      toast({ title: "Queued again", description: "It will be sent to the cloud on the next sync." });
    } catch (err) {
      toast({ title: "Could not retry", description: describeApiError(err).message, variant: "destructive" });
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const discard = async (p: Problem) => {
    setBusy(p.seq);
    try {
      await apiRequest("POST", `/api/local/problems/${p.seq}/discard`, {});
      toast({ title: "Discarded", description: "The order was refreshed from the cloud." });
    } catch (err) {
      toast({ title: "Could not discard", description: describeApiError(err).message, variant: "destructive" });
    } finally {
      setBusy(null);
      setConfirming(null);
      refresh();
    }
  };

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <h1 className="font-display text-2xl text-[var(--text-strong)]">Sync</h1>
      <p className="mt-1 text-sm text-[var(--text-2)]">
        {status.online === false ? "This PC is offline." : "This PC is online."}{" "}
        {(status.outboxPending ?? 0) > 0 ? `${status.outboxPending} action(s) waiting to be sent to the cloud.` : "Nothing is waiting to be sent."}
      </p>

      <h2 className="mt-6 text-sm font-semibold text-[var(--text-strong)]">Actions the cloud refused</h2>
      <p className="text-xs text-[var(--text-3)]">
        These were done on this PC, but the cloud had a newer version of the order (or rejected them). The order has been
        refreshed from the cloud. Retry sends the action again as it was; Discard gives up on it.
      </p>
      <div className="mt-3 space-y-2">
        {isLoading && <div className="text-sm text-[var(--text-3)]">Loading…</div>}
        {!isLoading && problems.length === 0 && (
          <div className="rounded-lg border border-[var(--line)] p-4 text-sm text-[var(--text-2)]">No problems.</div>
        )}
        {problems.map((p) => (
          <div key={p.seq} data-testid={`sync-problem-${p.seq}`} className="rounded-lg border border-red-200 bg-red-50/50 p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="font-semibold text-[var(--text-strong)]">
                {describeAction(p.method, p.path)}
                {p.orderId != null && <span className="ml-2 font-mono text-xs text-[var(--text-2)]">#{p.orderId}</span>}
              </div>
              <div className="text-xs text-[var(--text-3)]">{new Date(p.createdAt).toLocaleString()}</div>
            </div>
            <div className="mt-1 text-sm text-red-700">{p.lastError ?? "Refused by the cloud"}</div>
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="outline" disabled={busy === p.seq} onClick={() => retry(p)}>Retry</Button>
              {canDiscard && (
                <Button size="sm" variant="destructive" disabled={busy === p.seq} onClick={() => setConfirming(p)}>Discard</Button>
              )}
            </div>
          </div>
        ))}
      </div>

      <Dialog open={!!confirming} onOpenChange={(o) => { if (!o && !pinOpen) setConfirming(null); }}>
        <DialogContent {...lockedDialogProps(pinOpen)}>
          <DialogHeader>
            <DialogTitle>Discard this action?</DialogTitle>
            <DialogDescription>
              {confirming ? `${describeAction(confirming.method, confirming.path)}${confirming.orderId != null ? ` on #${confirming.orderId}` : ""}` : ""}
              {" "}will never be sent to the cloud. The order keeps the cloud's version. A manager or admin PIN is needed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(null)}>Keep it</Button>
            <Button variant="destructive" onClick={() => setPinOpen(true)}>Discard (PIN)</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {pinOpen && confirming && (
        <PinGuard
          actionLabel="Discard unsynced action"
          requiredRole="manager"
          onCancel={() => setPinOpen(false)}
          onSuccess={() => { setPinOpen(false); void discard(confirming); }}
        />
      )}
    </div>
  );
}
