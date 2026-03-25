import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { BagichaLogo } from "@/components/BagichaLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Plus, Edit2, Trash2, Users, ArrowRightLeft, X,
  RefreshCw, LogOut, BarChart2, Truck, ShoppingBag,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";

interface Table {
  id: number;
  name: string;
  capacity: number;
  status: "free" | "running" | "billed";
  currentOrderId?: number | null;
  section: string;
  runningTotal?: number;
}

const SECTION_OPTIONS = [
  { value: "inner",   label: "Inner" },
  { value: "outer",   label: "Outer" },
  { value: "vip",     label: "VIP" },
  { value: "terrace", label: "Terrace" },
  { value: "hall",    label: "Hall" },
];

// Petpooja-style status colours
const statusConfig = {
  free: {
    bg: "bg-white dark:bg-zinc-900",
    border: "border-dashed border-2 border-zinc-300 dark:border-zinc-600",
    nameText: "text-zinc-700 dark:text-zinc-300",
    subText: "text-zinc-400 dark:text-zinc-500",
  },
  running: {
    bg: "bg-blue-100 dark:bg-blue-950/50",
    border: "border border-blue-300 dark:border-blue-700",
    nameText: "text-blue-900 dark:text-blue-100",
    subText: "text-blue-600 dark:text-blue-400",
  },
  billed: {
    bg: "bg-yellow-100 dark:bg-yellow-950/50",
    border: "border border-yellow-300 dark:border-yellow-700",
    nameText: "text-yellow-900 dark:text-yellow-100",
    subText: "text-yellow-600 dark:text-yellow-400",
  },
};

const fmt = (n: number) => `₹${n.toFixed(0)}`;

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
  const { user, logout } = useAuth();
  const { toast } = useToast();

  const [showAdd, setShowAdd] = useState(false);
  const [editTable, setEditTable] = useState<Table | null>(null);
  const [shiftFrom, setShiftFrom] = useState<Table | null>(null);
  const [form, setForm] = useState({ name: "", capacity: "4", section: "inner" });

  const { data: tables = [], isLoading, refetch } = useQuery<Table[]>({
    queryKey: ["/api/tables"],
    staleTime: 0,
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
    if (table.status === "running" && table.currentOrderId) {
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

  const handleLogout = async () => {
    try {
      await logout();
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    } catch {
      toast({ title: "Logout failed", variant: "destructive" });
    }
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-background overflow-hidden">

      {/* ── Top Nav Bar (Petpooja style) ───────────────────────────────────────── */}
      <header className="shrink-0 h-14 bg-card border-b border-border flex items-center px-4 gap-3 shadow-sm">
        {/* Logo */}
        <div className="flex items-center gap-3 shrink-0">
          <BagichaLogo size="sm" />
        </div>

        <div className="w-px h-6 bg-border mx-1 shrink-0" />

        {/* Title */}
        <span className="text-base font-bold text-foreground tracking-tight shrink-0">
          Table View
        </span>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Shift banner */}
        {shiftFrom && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-400/30 text-amber-600 text-sm font-medium">
            <ArrowRightLeft className="w-3.5 h-3.5" />
            Shifting {shiftFrom.name} — click a free table
            <button
              onClick={() => setShiftFrom(null)}
              className="hover:text-amber-800 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Action buttons */}
        <button
          onClick={() => refetch()}
          className="w-9 h-9 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          title="Refresh"
        >
          <RefreshCw className="w-4 h-4" />
        </button>

        <Button
          size="sm"
          variant="outline"
          onClick={() => navigate("/pos")}
          className="gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" />
          New Order
        </Button>

        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 hidden sm:flex"
          onClick={() => navigate("/pos?orderType=delivery")}
        >
          <Truck className="w-3.5 h-3.5" />
          Delivery
        </Button>

        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 hidden sm:flex"
          onClick={() => navigate("/pos?orderType=takeaway")}
        >
          <ShoppingBag className="w-3.5 h-3.5" />
          Take Away
        </Button>

        <div className="w-px h-6 bg-border mx-1 shrink-0" />

        <Button
          size="sm"
          variant="outline"
          onClick={() => navigate("/live-analytics")}
          className="gap-1.5 h-8 text-xs"
        >
          <BarChart2 className="w-3.5 h-3.5" />
          Live Analytics
        </Button>

        {/* User + Logout */}
        <div className="flex items-center gap-2 pl-1">
          <div className="hidden sm:flex flex-col text-right">
            <span className="text-xs font-semibold text-foreground leading-none">
              {user?.username ?? "—"}
            </span>
            <span className="text-[10px] text-muted-foreground capitalize mt-0.5">
              {user?.role ?? "staff"}
            </span>
          </div>
          <button
            onClick={handleLogout}
            className="w-9 h-9 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
            title="Sign out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* ── Live Status Bar ────────────────────────────────────────────────────── */}
      <div className="shrink-0 bg-muted/30 border-b border-border/50 flex items-center px-4 gap-2 py-2 flex-wrap">

        {/* Running Tables */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800">
          <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
          <span className="text-xs text-red-600 dark:text-red-400 font-medium">Running</span>
          <span className="text-sm font-bold text-red-700 dark:text-red-300 min-w-[1ch] text-center">
            {liveStatus?.runningTables ?? runningTables.length}
          </span>
        </div>

        {/* Free Tables */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800">
          <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
          <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">Free</span>
          <span className="text-sm font-bold text-emerald-700 dark:text-emerald-300 min-w-[1ch] text-center">
            {liveStatus?.freeTables ?? freeTables.length}
          </span>
        </div>

        {/* Active Orders */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800">
          <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
          <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">Orders</span>
          <span className="text-sm font-bold text-blue-700 dark:text-blue-300 min-w-[1ch] text-center">
            {liveStatus?.activeOrders ?? 0}
          </span>
        </div>

        {/* Today Sales */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-800">
          <span className="w-2 h-2 rounded-full bg-violet-500 shrink-0" />
          <span className="text-xs text-violet-600 dark:text-violet-400 font-medium">Sales</span>
          <span className="text-sm font-bold text-violet-700 dark:text-violet-300">
            ₹{(liveStatus?.todaySales ?? 0).toFixed(0)}
          </span>
        </div>

        <div className="flex-1" />

        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs gap-1 shrink-0"
          onClick={() => {
            setEditTable(null);
            setForm({ name: "", capacity: "4", section: "inner" });
            setShowAdd(true);
          }}
        >
          <Plus className="w-3 h-3" />
          Add Table
        </Button>
      </div>

      {/* ── Table Grid ─────────────────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto p-5 space-y-8">
        {isLoading ? (
          <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-3">
            {[...Array(16)].map((_, i) => (
              <div key={i} className="h-20 rounded-xl bg-muted animate-pulse" />
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
                <h2 className="text-sm font-bold text-foreground uppercase tracking-wider">
                  {sectionLabel(section)}
                </h2>
                <div className="flex-1 h-px bg-border" />
                <span className="text-xs text-muted-foreground">
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
                          ${cfg.bg} ${cfg.border}
                          ${isShiftTarget ? "ring-2 ring-amber-400 ring-offset-1" : ""}
                          ${isShiftSource ? "ring-2 ring-primary ring-offset-1" : ""}
                        `}
                      >
                        {/* Main content */}
                        <div className="p-2.5 min-h-[72px] flex flex-col justify-between">
                          <div>
                            <p className={`text-sm font-bold leading-tight truncate ${cfg.nameText}`}>
                              {table.name}
                            </p>
                            {table.status === "running" && table.runningTotal != null && (
                              <p className={`text-xs font-semibold mt-0.5 ${cfg.subText}`}>
                                {fmt(table.runningTotal)}
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
                            className="w-6 h-6 rounded-md bg-black/5 dark:bg-white/10 flex items-center justify-center hover:bg-black/10 dark:hover:bg-white/20 transition-colors"
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
    </div>
  );
}
