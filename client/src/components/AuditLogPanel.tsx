import { apiUrl } from '@/lib/api';
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChevronLeft, ChevronRight, ShieldCheck } from "lucide-react";
import { format } from "date-fns";
import { ACTION_LABELS, actionLabel, metaSummary } from "@/lib/auditFormat";

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
      const res = await fetch(apiUrl(`/api/admin/audit-logs?${params}`));
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
              const badge = actionLabel(log.action);
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
