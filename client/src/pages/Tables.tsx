import { apiUrl } from '@/lib/api';
import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Plus, Edit2, Trash2, Users, ArrowRightLeft, Printer, UserRound,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { useLiveOrders } from "@/hooks/useLiveOrders";
import { LiveOrdersPanel, LiveOrdersStrip } from "@/components/live-tables/LiveOrdersPanel";

interface Table {
  id: number;
  name: string;
  capacity: number;
  status: "free" | "running" | "billed";
  currentOrderId?: number | null;
  section: string;
  runningTotal?: number;
  orderCreatedAt?: string;
  servedByName?: string | null;
}

const SECTION_OPTIONS = [
  { value: "inner",   label: "Inner" },
  { value: "outer",   label: "Outer" },
  { value: "vip",     label: "VIP" },
  { value: "terrace", label: "Terrace" },
  { value: "hall",    label: "Hall" },
];

// Warm garden status card styles (free / running / billed)
const statusConfig = {
  free: {
    style: {
      background: "var(--paper-0)",
      border: "1.5px dashed var(--line-strong)",
      boxShadow: "var(--shadow-xs)",
    },
    nameText: "text-[var(--text-1)]",
    subText: "text-[var(--text-3)]",
  },
  running: {
    style: {
      background: "var(--success-bg)",
      border: "1px solid #BBD9C4",
      boxShadow: "0 4px 20px rgba(46,139,87,0.10)",
    },
    nameText: "text-[var(--green-900)]",
    subText: "text-[var(--green-700)]",
  },
  billed: {
    style: {
      background: "var(--warning-bg)",
      border: "1px solid #EAD9AE",
      boxShadow: "0 4px 20px rgba(198,138,46,0.10)",
    },
    nameText: "text-[var(--clay-700)]",
    subText: "text-[var(--amber-600)]",
  },
};

const fmt = (n: number) => `₹${n.toFixed(0)}`;

/** Shows elapsed time as "X Min" or "Xh Xm", updates every minute */
function RunningTimer({ startedAt }: { startedAt: string }) {
  const getElapsed = (s: string) => {
    const totalMins = Math.floor((Date.now() - new Date(s).getTime()) / 60000);
    const h = Math.floor(totalMins / 60);
    const m = totalMins % 60;
    return { h, m };
  };
  const [elapsed, setElapsed] = useState(() => getElapsed(startedAt));
  useEffect(() => {
    setElapsed(getElapsed(startedAt));
    const id = setInterval(() => setElapsed(getElapsed(startedAt)), 60000);
    return () => clearInterval(id);
  }, [startedAt]);
  const display = elapsed.h > 0 ? `${elapsed.h}h ${elapsed.m}m` : `${elapsed.m} Min`;
  return <span>{display}</span>;
}

/** Fetches order createdAt when not available from table data */
function TableTimer({ orderId }: { orderId: number }) {
  const { data } = useQuery<any>({
    queryKey: ["/api/orders", String(orderId)],
    staleTime: Infinity,
  });
  if (!data?.createdAt) return <span>Active</span>;
  return <RunningTimer startedAt={data.createdAt} />;
}

function groupBySection(tables: Table[]): Record<string, Table[]> {
  return tables.reduce((acc, t) => {
    const k = t.section || "inner";
    acc[k] = acc[k] ? [...acc[k], t] : [t];
    return acc;
  }, {} as Record<string, Table[]>);
}

function sectionLabel(s: string) {
  return SECTION_OPTIONS.find(x => x.value === s)?.label
    ?? (s.charAt(0).toUpperCase() + s.slice(1));
}

export default function Tables() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { deliveryOrders, pickupOrders } = useLiveOrders();

  const printTableBill = async (orderId: number) => {
    try {
      const { printBillDirect } = await import("@/lib/printGateway");
      const outcome = await printBillDirect(orderId);
      if (outcome === "hardware") {
        toast({ title: "Bill sent to printer!" });
        queryClient.invalidateQueries({ queryKey: ["/api/tables"] });
      } else if (outcome === "browser") {
        toast({
          title: "Cannot direct-print to this printer",
          description:
            "Use a thermal receipt printer in Settings, or print from the Billing screen.",
          variant: "destructive",
        });
      } else if (outcome === "noop") {
        toast({
          title: "Use desktop app to print",
          description: "Open Bagicha POS in Electron for direct thermal printing.",
          variant: "destructive",
        });
      }
    } catch (err: any) {
      toast({
        title: "Bill print failed",
        description: err?.message ?? "Could not print bill",
        variant: "destructive",
      });
    }
  };

  const [showAdd, setShowAdd] = useState(false);
  const [editTable, setEditTable] = useState<Table | null>(null);
  const [shiftFrom, setShiftFrom] = useState<Table | null>(null);
  const [form, setForm] = useState({ name: "", capacity: "4", section: "inner" });

  const { data: tables = [], isLoading } = useQuery<Table[]>({
    queryKey: ["/api/tables"],
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: 5000,
  });

  const { data: liveStatus } = useQuery<{
    runningTables: number;
    freeTables: number;
    activeOrders: number;
    todaySales: number;
  }>({
    queryKey: ["/api/live-status"],
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: 5000,
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/tables", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tables"] });
      toast({ title: "Table created" });
      setShowAdd(false);
      setForm({ name: "", capacity: "4", section: "inner" });
    },
    onError: () => toast({ title: "Failed to create table", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: any) => apiRequest("PUT", `/api/tables/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tables"] });
      toast({ title: "Table updated" });
      setEditTable(null);
      setShowAdd(false);
    },
    onError: () => toast({ title: "Failed to update table", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/tables/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tables"] });
      toast({ title: "Table deleted" });
    },
    onError: () => toast({ title: "Failed to delete table", variant: "destructive" }),
  });

  const shiftMutation = useMutation({
    mutationFn: ({ fromId, toId }: any) =>
      apiRequest("POST", `/api/tables/${fromId}/shift`, { toTableId: toId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tables"] });
      toast({ title: "Order shifted" });
      setShiftFrom(null);
    },
    onError: (e: any) =>
      toast({ title: e.message || "Failed to shift", variant: "destructive" }),
  });

  const grouped = groupBySection(tables);
  const sectionOrder = [
    "inner", "outer", "vip", "terrace", "hall",
    ...Object.keys(grouped).filter(
      k => !["inner", "outer", "vip", "terrace", "hall"].includes(k)
    ),
  ].filter(k => grouped[k]);

  const freeTables  = tables.filter(t => t.status === "free");
  const runningTables = tables.filter(t => t.status === "running");

  const handleTableClick = (table: Table) => {
    if (shiftFrom) {
      if (shiftFrom.id === table.id) { setShiftFrom(null); return; }
      if (table.status === "free") {
        shiftMutation.mutate({ fromId: shiftFrom.id, toId: table.id });
      } else {
        toast({ title: "Can only shift to a free table", variant: "destructive" });
      }
      return;
    }
    if ((table.status === "running" || table.status === "billed") && table.currentOrderId) {
      navigate(
        `/pos?tableId=${table.id}&orderId=${table.currentOrderId}&tableName=${encodeURIComponent(table.name)}`
      );
    } else if (table.status === "free") {
      navigate(`/pos?tableId=${table.id}&tableName=${encodeURIComponent(table.name)}`);
    }
  };

  const handleSave = () => {
    if (!form.name.trim()) return;
    if (editTable) {
      updateMutation.mutate({
        id: editTable.id,
        data: { name: form.name, capacity: Number(form.capacity), section: form.section },
      });
    } else {
      createMutation.mutate({
        name: form.name,
        capacity: Number(form.capacity),
        section: form.section,
      });
    }
  };

  const openEdit = (e: React.MouseEvent, table: Table) => {
    e.stopPropagation();
    setEditTable(table);
    setForm({ name: table.name, capacity: String(table.capacity), section: table.section || "inner" });
    setShowAdd(true);
  };

  const handleDelete = (e: React.MouseEvent, table: Table) => {
    e.stopPropagation();
    if (table.status !== "free") {
      toast({ title: "Cannot delete a table with an active order", variant: "destructive" });
      return;
    }
    if (confirm(`Delete table "${table.name}"?`)) deleteMutation.mutate(table.id);
  };

  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ background: "transparent" }}>

      {/* ── Live Status Bar ────────────────────────────────────────────────────── */}
      <div className="shrink-0 px-3 sm:px-4 py-2"
        style={{
          background: "var(--paper-0)",
          borderBottom: "1px solid var(--line)",
          boxShadow: "0 2px 12px rgba(20,34,27,0.05)",
        }}
      >
        {/* Row 1: Status pills + desktop action buttons */}
        <div className="flex items-center gap-1.5 sm:gap-2">

          {/* Running Tables */}
          <div className="flex items-center gap-1.5 px-2 py-1 sm:px-3 sm:py-1.5 rounded-xl"
            style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.18)", boxShadow: "0 1px 4px rgba(239,68,68,0.08)" }}>
            <span className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-red-500 shrink-0" />
            <span className="text-[10px] sm:text-xs text-red-600 font-semibold">Running</span>
            <span className="text-xs sm:text-sm font-bold text-red-700 min-w-[1ch] text-center">
              {liveStatus?.runningTables ?? runningTables.length}
            </span>
          </div>

          {/* Free Tables */}
          <div className="flex items-center gap-1.5 px-2 py-1 sm:px-3 sm:py-1.5 rounded-xl"
            style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.20)", boxShadow: "0 1px 4px rgba(16,185,129,0.08)" }}>
            <span className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-emerald-500 shrink-0" />
            <span className="text-[10px] sm:text-xs text-emerald-600 font-semibold">Free</span>
            <span className="text-xs sm:text-sm font-bold text-emerald-700 min-w-[1ch] text-center">
              {liveStatus?.freeTables ?? freeTables.length}
            </span>
          </div>

          {/* Active Orders */}
          <div className="flex items-center gap-1.5 px-2 py-1 sm:px-3 sm:py-1.5 rounded-xl"
            style={{ background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.20)", boxShadow: "0 1px 4px rgba(59,130,246,0.08)" }}>
            <span className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-blue-500 shrink-0" />
            <span className="text-[10px] sm:text-xs text-blue-600 font-semibold">Orders</span>
            <span className="text-xs sm:text-sm font-bold text-blue-700 min-w-[1ch] text-center">
              {liveStatus?.activeOrders ?? 0}
            </span>
          </div>

          {/* Today Sales */}
          <div className="flex items-center gap-1.5 px-2 py-1 sm:px-3 sm:py-1.5 rounded-xl"
            style={{ background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.20)", boxShadow: "0 1px 4px rgba(139,92,246,0.08)" }}>
            <span className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-violet-500 shrink-0" />
            <span className="text-[10px] sm:text-xs text-violet-600 font-semibold">Sales</span>
            <span className="text-xs sm:text-sm font-bold text-violet-700">
              ₹{(liveStatus?.todaySales ?? 0).toFixed(0)}
            </span>
          </div>

          {/* Desktop: spacer + action buttons */}
          <div className="hidden sm:block flex-1" />
          <Button
            size="sm"
            variant="ghost"
            className="hidden sm:flex h-7 text-xs gap-1 shrink-0"
            onClick={() => { setEditTable(null); setForm({ name: "", capacity: "4", section: "inner" }); setShowAdd(true); }}
          >
            <Plus className="w-3 h-3" /> Add Table
          </Button>
          <Button size="sm" className="hidden sm:flex h-7 text-xs gap-1 shrink-0 bg-blue-600 hover:bg-blue-700 text-white" onClick={() => navigate("/pos?mode=delivery")}>
            🛵 Delivery
          </Button>
          <Button size="sm" className="hidden sm:flex h-7 text-xs gap-1 shrink-0 bg-orange-500 hover:bg-orange-600 text-white" onClick={() => navigate("/pos?mode=pickup")}>
            📦 Pick Up
          </Button>
        </div>

        {/* Row 2: Action buttons — mobile only */}
        <div className="flex items-center gap-1.5 mt-1.5 sm:hidden">
          <Button
            size="sm"
            variant="outline"
            className="flex-1 h-7 text-[10px] gap-1"
            onClick={() => { setEditTable(null); setForm({ name: "", capacity: "4", section: "inner" }); setShowAdd(true); }}
          >
            <Plus className="w-3 h-3" /> Add Table
          </Button>
          <Button size="sm" className="h-7 text-[10px] gap-1 bg-blue-600 hover:bg-blue-700 text-white px-2.5" onClick={() => navigate("/pos?mode=delivery")}>
            🛵 Delivery
          </Button>
          <Button size="sm" className="h-7 text-[10px] gap-1 bg-orange-500 hover:bg-orange-600 text-white px-2.5" onClick={() => navigate("/pos?mode=pickup")}>
            📦 Pickup
          </Button>
        </div>
      </div>

      {/* ── Table Grid ─────────────────────────────────────────────────────────── */}
      <main className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-5 space-y-4 sm:space-y-8">
        <LiveOrdersStrip deliveryOrders={deliveryOrders} pickupOrders={pickupOrders} />

        {/* ── Staff on Floor panel ─────────────────────────────────────── */}
        {runningTables.length > 0 && (() => {
          const byStaff = runningTables.reduce((acc, t) => {
            const key = t.servedByName || "—";
            (acc[key] ??= []).push(t.name);
            return acc;
          }, {} as Record<string, string[]>);
          return (
            <div
              className="rounded-2xl px-4 py-3"
              style={{
                background: "var(--paper-0)",
                border: "1px solid var(--line)",
                boxShadow: "var(--shadow-sm)",
              }}
            >
              <div className="flex items-center gap-2 mb-2.5">
                <UserRound className="w-3.5 h-3.5 text-blue-500" />
                <span className="text-xs font-bold uppercase tracking-wide text-blue-700">
                  Staff on floor
                </span>
                <span className="text-xs text-blue-400 font-medium">
                  · {runningTables.length} table{runningTables.length !== 1 ? "s" : ""} active
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(byStaff).map(([name, tableNames]) => (
                  <div
                    key={name}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl"
                    style={{
                      background: name === "—" ? "rgba(0,0,0,0.04)" : "rgba(59,130,246,0.08)",
                      border: name === "—" ? "1px solid rgba(0,0,0,0.08)" : "1px solid rgba(147,197,253,0.45)",
                    }}
                  >
                    <span className={`text-xs font-semibold ${name === "—" ? "text-zinc-400" : "text-blue-700"}`}>
                      {name}
                    </span>
                    <span className="text-[10px] text-zinc-400">→</span>
                    <span className="text-xs text-zinc-600 font-medium">
                      {tableNames.join(", ")}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {isLoading ? (
          <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-7 lg:grid-cols-9 xl:grid-cols-11 gap-3">
            {[...Array(16)].map((_, i) => (
              <div key={i} className="h-20 skeleton-glass" />
            ))}
          </div>
        ) : tables.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full py-24 text-center">
            <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
              <Users className="w-8 h-8 text-muted-foreground" />
            </div>
            <p className="text-lg font-semibold mb-1">No tables yet</p>
            <p className="text-muted-foreground text-sm mb-4">
              Add tables to start managing dine-in orders
            </p>
            <Button
              onClick={() => setShowAdd(true)}
            >
              <Plus className="w-4 h-4 mr-1" /> Add First Table
            </Button>
          </div>
        ) : (
          sectionOrder.map(section => (
            <div key={section}>
              {/* Section heading */}
              <div className="flex items-center gap-3 mb-3">
                <h2 className="text-xs font-bold text-foreground uppercase tracking-[0.1em]">
                  {sectionLabel(section)}
                </h2>
                <div className="flex-1 h-px" style={{ background: "var(--paper-0)", boxShadow: "0 1px 0 rgba(0,0,0,0.06)" }} />
                <span className="text-xs text-muted-foreground font-medium">
                  {grouped[section].filter(t => t.status === "running").length} running
                  {" · "}
                  {grouped[section].length} tables
                </span>
              </div>

              <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-7 lg:grid-cols-9 xl:grid-cols-11 gap-3">
                <AnimatePresence mode="popLayout">
                  {grouped[section].map((table, i) => {
                    const cfg = statusConfig[table.status] || statusConfig.free;
                    const isShiftSource = shiftFrom?.id === table.id;
                    const isShiftTarget =
                      !!shiftFrom && shiftFrom.id !== table.id && table.status === "free";

                    return (
                      <motion.div
                        key={table.id}
                        layout
                        initial={{ opacity: 0, scale: 0.88 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.85 }}
                        transition={{ delay: i * 0.025, duration: 0.18 }}
                        whileHover={{ scale: 1.06, transition: { duration: 0.1 } }}
                        onClick={() => handleTableClick(table)}
                        className={`
                          relative rounded-xl cursor-pointer select-none group
                          ${isShiftTarget ? "ring-2 ring-amber-400 ring-offset-1" : ""}
                          ${isShiftSource ? "ring-2 ring-primary ring-offset-1" : ""}
                        `}
                        style={cfg.style}
                      >
                        {/* Main content */}
                        <div className="p-2.5 min-h-[72px] flex flex-col justify-between">
                          <div>
                            {/* Running: timer on top */}
                            {table.status === "running" && (
                              <p className={`text-[11px] font-semibold leading-tight ${cfg.subText}`}>
                                {table.orderCreatedAt
                                  ? <RunningTimer startedAt={table.orderCreatedAt} />
                                  : table.currentOrderId
                                    ? <TableTimer orderId={table.currentOrderId} />
                                    : "Active"}
                              </p>
                            )}
                            <p className={`text-sm font-bold leading-tight truncate ${cfg.nameText}`}>
                              {table.name}
                            </p>
                            {table.status === "running" && table.runningTotal != null && (
                              <p className={`text-xs font-semibold mt-0.5 ${cfg.subText}`}>
                                {fmt(table.runningTotal)}
                              </p>
                            )}
                            {table.status === "running" && table.servedByName && (
                              <p className="flex items-center gap-0.5 text-[10px] font-medium mt-0.5 text-blue-500 truncate">
                                <UserRound className="w-2.5 h-2.5 shrink-0" />
                                {table.servedByName}
                              </p>
                            )}
                            {table.status === "free" && (
                              <p className={`text-xs mt-0.5 flex items-center gap-0.5 ${cfg.subText}`}>
                                <Users className="w-2.5 h-2.5" />
                                {table.capacity}
                              </p>
                            )}
                            {table.status === "billed" && (
                              <p className={`text-xs font-medium mt-0.5 ${cfg.subText}`}>
                                Bill printed
                              </p>
                            )}
                          </div>

                          {/* Print button — always visible for running tables */}
                          {table.status === "running" && table.currentOrderId && (
                            <button
                              onClick={e => {
                                e.stopPropagation();
                                printTableBill(table.currentOrderId!);
                              }}
                              className="mt-1.5 w-7 h-7 rounded-lg flex items-center justify-center bg-blue-600 hover:bg-blue-700 text-white transition-colors shadow-sm"
                              title="Print bill"
                            >
                              <Printer className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>

                        {/* Hover action bar */}
                        <div
                          className="px-2 pb-2 flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={e => e.stopPropagation()}
                        >
                          {table.status === "running" && (
                            <button
                              onClick={e => { e.stopPropagation(); setShiftFrom(table); }}
                              className="w-6 h-6 rounded-md flex items-center justify-center hover:bg-blue-200 dark:hover:bg-blue-900 text-blue-600 transition-colors"
                              title="Shift table"
                            >
                              <ArrowRightLeft className="w-3 h-3" />
                            </button>
                          )}
                          <button
                            onClick={e => openEdit(e, table)}
                            className="w-6 h-6 rounded-md bg-black/5 dark:bg-white/10 flex items-center justify-center hover:bg-black/10 dark:hover:bg-[var(--paper-100)] transition-colors"
                            title="Edit"
                          >
                            <Edit2 className="w-3 h-3 text-zinc-600 dark:text-zinc-300" />
                          </button>
                          <button
                            onClick={e => handleDelete(e, table)}
                            className="w-6 h-6 rounded-md bg-black/5 dark:bg-white/10 flex items-center justify-center hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
                            title="Delete"
                          >
                            <Trash2 className="w-3 h-3 text-zinc-600 dark:text-zinc-300" />
                          </button>
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            </div>
          ))
        )}
      </main>

      {/* ── Add / Edit Table Dialog ────────────────────────────────────────────── */}
      <Dialog
        open={showAdd}
        onOpenChange={o => { if (!o) { setShowAdd(false); setEditTable(null); } }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{editTable ? "Edit Table" : "Add New Table"}</DialogTitle>
            <DialogDescription>
              {editTable
                ? "Update this table's name, capacity and section."
                : "Create a new table with a name, capacity and section."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Table Name</label>
              <Input
                placeholder="e.g. T1, Family 1, VIP 1"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                onKeyDown={e => e.key === "Enter" && handleSave()}
                autoFocus
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Capacity (seats)</label>
              <Input
                type="number"
                min="1"
                max="50"
                value={form.capacity}
                onChange={e => setForm(f => ({ ...f, capacity: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Section</label>
              <Select
                value={form.section}
                onValueChange={v => setForm(f => ({ ...f, section: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select section" />
                </SelectTrigger>
                <SelectContent>
                  {SECTION_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2 pt-1">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => { setShowAdd(false); setEditTable(null); }}
              >
                Cancel
              </Button>
              <Button
                className="flex-1"
                disabled={
                  !form.name.trim() ||
                  createMutation.isPending ||
                  updateMutation.isPending
                }
                onClick={handleSave}
              >
                {editTable ? "Save Changes" : "Add Table"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <LiveOrdersPanel deliveryOrders={deliveryOrders} pickupOrders={pickupOrders} />
    </div>
  );
}
