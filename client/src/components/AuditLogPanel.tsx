import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChevronLeft, ChevronRight, ShieldCheck } from "lucide-react";
import { format } from "date-fns";

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  "order.payment":        { label: "Payment",        color: "bg-green-100 text-green-800" },
  "order.cancel":         { label: "Cancellation",   color: "bg-red-100 text-red-800" },
  "order.coupon_applied": { label: "Coupon Applied", color: "bg-yellow-100 text-yellow-800" },
  "order.loyalty_redeemed": { label: "Loyalty Redeemed", color: "bg-amber-100 text-amber-800" },
  "user.create":          { label: "User Created",   color: "bg-blue-100 text-blue-800" },
  "user.update":          { label: "User Updated",   color: "bg-blue-100 text-blue-800" },
  "user.delete":          { label: "User Deleted",   color: "bg-red-100 text-red-800" },
  "user.pin_update":      { label: "PIN Changed",    color: "bg-orange-100 text-orange-800" },
  "user.pin_reset_all":   { label: "All PINs Reset", color: "bg-orange-100 text-orange-800" },
  "coupon.issue":         { label: "Coupon Issued",  color: "bg-purple-100 text-purple-800" },
  "settings.update":      { label: "Settings Changed", color: "bg-gray-100 text-gray-800" },
};

const PAGE_SIZE = 25;

type AuditLog = {
  id: number;
  actorId: string;
  actorName: string;
  actorRole: string;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
};

function metaSummary(action: string, meta: Record<string, unknown> | null): string {
  if (!meta) return "";
  if (action === "order.payment") return `₹${meta.amount} via ${meta.paymentMethod}`;
  if (action === "order.cancel") return `Order ${meta.orderNumber ?? ""} table ${meta.tableNumber ?? ""}`;
  if (action === "order.coupon_applied") return `Coupon #${meta.couponId} → ₹${meta.discount} off`;
  if (action === "order.loyalty_redeemed") return `${meta.points} pts → ₹${meta.discount} off`;
  if (action === "user.create") return `${meta.username} (${meta.role})`;
  if (action === "user.update") return `Fields: ${(meta.fields as string[])?.join(", ")}`;
  if (action === "user.pin_reset_all") return `${meta.count} users cleared`;
  if (action === "user.pin_update") return meta.cleared ? "PIN cleared" : "PIN set";
  if (action === "coupon.issue") return `${meta.code} — ${meta.type} ₹${meta.value}`;
  if (action === "settings.update") return `Fields: ${(meta.fields as string[])?.join(", ")}`;
  return JSON.stringify(meta).slice(0, 60);
}

export function AuditLogPanel() {
  const [page, setPage] = useState(0);
  const [filterAction, setFilterAction] = useState<string>("all");

  const { data: logs = [], isLoading } = useQuery<AuditLog[]>({
    queryKey: ["/api/admin/audit-logs", page, filterAction],
    queryFn: async () => {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
      });
      if (filterAction !== "all") params.set("action", filterAction);
      const res = await fetch(`/api/admin/audit-logs?${params}`);
      if (!res.ok) throw new Error("Failed to fetch audit logs");
      return res.json();
    },
    refetchInterval: 30_000,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-muted-foreground" />
        <h3 className="font-semibold">Audit Log</h3>
        <span className="text-xs text-muted-foreground ml-auto">Immutable — all sensitive actions recorded</span>
      </div>

      <div className="flex gap-2 items-center">
        <Select value={filterAction} onValueChange={v => { setFilterAction(v); setPage(0); }}>
          <SelectTrigger className="w-52">
            <SelectValue placeholder="Filter by action" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All actions</SelectItem>
            {Object.entries(ACTION_LABELS).map(([key, { label }]) => (
              <SelectItem key={key} value={key}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">Page {page + 1}</span>
      </div>

      <ScrollArea className="h-[500px] rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-36">Time</TableHead>
              <TableHead className="w-28">Actor</TableHead>
              <TableHead className="w-20">Role</TableHead>
              <TableHead className="w-36">Action</TableHead>
              <TableHead>Details</TableHead>
              <TableHead className="w-28">IP</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Loading…</TableCell>
              </TableRow>
            ) : logs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No audit entries yet</TableCell>
              </TableRow>
            ) : logs.map(log => {
              const badge = ACTION_LABELS[log.action] ?? { label: log.action, color: "bg-gray-100 text-gray-700" };
              return (
                <TableRow key={log.id}>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {format(new Date(log.createdAt), "dd MMM HH:mm:ss")}
                  </TableCell>
                  <TableCell className="font-medium text-sm">{log.actorName}</TableCell>
                  <TableCell className="text-xs capitalize text-muted-foreground">{log.actorRole}</TableCell>
                  <TableCell>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.color}`}>
                      {badge.label}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {metaSummary(log.action, log.metadata)}
                    {log.entityId && <span className="ml-1 text-muted-foreground/60">#{log.entityId}</span>}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground font-mono">{log.ip ?? "—"}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </ScrollArea>

      <div className="flex items-center justify-between">
        <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>
          <ChevronLeft className="h-4 w-4" />
          Prev
        </Button>
        <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={logs.length < PAGE_SIZE}>
          Next
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
