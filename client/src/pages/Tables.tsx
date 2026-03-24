import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Header } from "@/components/Header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, Edit2, Trash2, Users, ArrowRightLeft, X } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";

interface Table {
  id: number;
  name: string;
  capacity: number;
  status: "free" | "running" | "billed";
  currentOrderId?: number | null;
  section: string;
}

const SECTIONS = [
  { value: "all",     label: "All" },
  { value: "inner",   label: "Inner" },
  { value: "outer",   label: "Outer" },
  { value: "vip",     label: "VIP" },
  { value: "terrace", label: "Terrace" },
  { value: "hall",    label: "Hall" },
];

const SECTION_OPTIONS = SECTIONS.filter(s => s.value !== "all");

const statusConfig = {
  free:    { label: "Free",    bg: "bg-emerald-500/10", border: "border-emerald-500/30", dot: "bg-emerald-500", text: "text-emerald-600" },
  running: { label: "Running", bg: "bg-red-500/10",     border: "border-red-500/30",     dot: "bg-red-500",     text: "text-red-600" },
  billed:  { label: "Billed",  bg: "bg-blue-500/10",    border: "border-blue-500/30",    dot: "bg-blue-500",    text: "text-blue-600" },
};

export default function Tables() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [activeSection, setActiveSection] = useState("all");
  const [showAdd, setShowAdd] = useState(false);
  const [editTable, setEditTable] = useState<Table | null>(null);
  const [shiftFrom, setShiftFrom] = useState<Table | null>(null);
  const [form, setForm] = useState({ name: "", capacity: "4", section: "inner" });

  const { data: tables = [], isLoading } = useQuery<Table[]>({
    queryKey: ["/api/tables"],
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
    mutationFn: ({ fromId, toId }: any) => apiRequest("POST", `/api/tables/${fromId}/shift`, { toTableId: toId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tables"] });
      toast({ title: "Order shifted successfully" });
      setShiftFrom(null);
    },
    onError: (e: any) => toast({ title: e.message || "Failed to shift table", variant: "destructive" }),
  });

  // Filter tables by active section tab
  const visibleTables = activeSection === "all"
    ? tables
    : tables.filter(t => t.section === activeSection);

  const freeTables = tables.filter(t => t.status === "free");
  const runningTables = tables.filter(t => t.status === "running");

  // Tabs: show only "All" + sections that have at least one table (plus the predefined ones)
  const usedSections = new Set(tables.map(t => t.section));
  const visibleTabs = SECTIONS.filter(s => s.value === "all" || usedSections.has(s.value));

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
      navigate(`/pos?tableId=${table.id}&orderId=${table.currentOrderId}`);
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
      createMutation.mutate({ name: form.name, capacity: Number(form.capacity), section: form.section });
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

  const sectionLabel = (s: string) =>
    SECTIONS.find(x => x.value === s)?.label ?? s.charAt(0).toUpperCase() + s.slice(1);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <Header title="Tables" description="Manage dine-in tables and seating" />

      <main className="min-h-0 flex-1 overflow-y-auto p-5">
        {/* Summary Bar */}
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span className="text-sm font-medium text-emerald-600">{freeTables.length} Free</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-red-500/10 border border-red-500/20">
            <span className="w-2 h-2 rounded-full bg-red-500" />
            <span className="text-sm font-medium text-red-600">{runningTables.length} Running</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {shiftFrom && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-600 text-sm font-medium">
                <ArrowRightLeft className="w-3.5 h-3.5" />
                Shifting from {shiftFrom.name} — tap a free table
                <button onClick={() => setShiftFrom(null)}><X className="w-3.5 h-3.5" /></button>
              </div>
            )}
            <Button
              onClick={() => { setEditTable(null); setForm({ name: "", capacity: "4", section: activeSection === "all" ? "inner" : activeSection }); setShowAdd(true); }}
              size="sm"
            >
              <Plus className="w-4 h-4 mr-1" /> Add Table
            </Button>
          </div>
        </div>

        {/* Section Tabs */}
        {visibleTabs.length > 1 && (
          <div className="flex gap-1.5 mb-5 overflow-x-auto pb-1">
            {visibleTabs.map(tab => (
              <button
                key={tab.value}
                onClick={() => setActiveSection(tab.value)}
                className={`relative px-4 py-2 rounded-xl text-sm font-medium transition-all whitespace-nowrap select-none ${
                  activeSection === tab.value
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {tab.label}
                {tab.value !== "all" && (
                  <span className={`ml-1.5 text-xs ${activeSection === tab.value ? "opacity-70" : "opacity-50"}`}>
                    ({tables.filter(t => t.section === tab.value).length})
                  </span>
                )}
                {activeSection === tab.value && (
                  <motion.div
                    layoutId="section-tab-indicator"
                    className="absolute inset-0 rounded-xl bg-primary -z-10"
                    transition={{ type: "spring", stiffness: 400, damping: 35 }}
                  />
                )}
              </button>
            ))}
          </div>
        )}

        {/* Table Grid */}
        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-36 rounded-2xl bg-muted animate-pulse" />
            ))}
          </div>
        ) : tables.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
              <Users className="w-8 h-8 text-muted-foreground" />
            </div>
            <p className="text-lg font-semibold mb-1">No tables yet</p>
            <p className="text-muted-foreground text-sm mb-4">Add tables to start managing dine-in orders</p>
            <Button onClick={() => setShowAdd(true)}><Plus className="w-4 h-4 mr-1" /> Add First Table</Button>
          </div>
        ) : visibleTables.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-muted-foreground text-sm">No tables in {sectionLabel(activeSection)} section</p>
            <Button
              size="sm"
              variant="outline"
              className="mt-3"
              onClick={() => { setEditTable(null); setForm({ name: "", capacity: "4", section: activeSection }); setShowAdd(true); }}
            >
              <Plus className="w-3.5 h-3.5 mr-1" /> Add table here
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            <AnimatePresence mode="popLayout">
              {visibleTables.map((table, i) => {
                const cfg = statusConfig[table.status] || statusConfig.free;
                const isShiftTarget = shiftFrom && shiftFrom.id !== table.id;
                return (
                  <motion.div
                    key={table.id}
                    layout
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.85 }}
                    transition={{ delay: i * 0.04, duration: 0.22 }}
                    whileHover={{ scale: 1.04, transition: { duration: 0.15 } }}
                    onClick={() => handleTableClick(table)}
                    className={`relative rounded-2xl border p-4 cursor-pointer select-none transition-all group ${cfg.bg} ${cfg.border} ${
                      isShiftTarget && table.status === "free" ? "ring-2 ring-amber-400 ring-offset-1" : ""
                    } ${shiftFrom?.id === table.id ? "ring-2 ring-primary ring-offset-1" : ""}`}
                  >
                    {/* Action buttons */}
                    <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                      <button
                        className="w-6 h-6 rounded-lg bg-background/80 flex items-center justify-center hover:bg-background shadow-sm"
                        onClick={(e) => openEdit(e, table)}
                      >
                        <Edit2 className="w-3 h-3 text-muted-foreground" />
                      </button>
                      <button
                        className="w-6 h-6 rounded-lg bg-background/80 flex items-center justify-center hover:bg-background shadow-sm"
                        onClick={(e) => handleDelete(e, table)}
                      >
                        <Trash2 className="w-3 h-3 text-muted-foreground" />
                      </button>
                    </div>

                    <div className="flex items-center gap-1.5 mb-3">
                      <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                      <span className={`text-xs font-medium ${cfg.text}`}>{cfg.label}</span>
                    </div>

                    <p className="text-base font-bold text-foreground mb-1 truncate">{table.name}</p>
                    <div className="flex items-center gap-1 text-muted-foreground mb-1">
                      <Users className="w-3 h-3" />
                      <span className="text-xs">{table.capacity} seats</span>
                    </div>
                    {activeSection === "all" && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-background/60 text-muted-foreground font-medium capitalize">
                        {sectionLabel(table.section)}
                      </span>
                    )}

                    {table.status === "running" && (
                      <button
                        className="mt-2 w-full flex items-center justify-center gap-1 text-xs text-amber-600 bg-amber-500/10 rounded-lg py-1 hover:bg-amber-500/20 transition-colors"
                        onClick={(e) => { e.stopPropagation(); setShiftFrom(table); }}
                      >
                        <ArrowRightLeft className="w-3 h-3" /> Shift
                      </button>
                    )}
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </main>

      {/* Add/Edit Dialog */}
      <Dialog open={showAdd} onOpenChange={(o) => { if (!o) { setShowAdd(false); setEditTable(null); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{editTable ? "Edit Table" : "Add New Table"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Table Name</label>
              <Input
                placeholder="e.g. T1, Family1, Terrace"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                onKeyDown={e => e.key === "Enter" && handleSave()}
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Capacity (seats)</label>
              <Input
                type="number"
                min="1"
                max="20"
                value={form.capacity}
                onChange={e => setForm(f => ({ ...f, capacity: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Section</label>
              <Select value={form.section} onValueChange={v => setForm(f => ({ ...f, section: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Select section" />
                </SelectTrigger>
                <SelectContent>
                  {SECTION_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1" onClick={() => { setShowAdd(false); setEditTable(null); }}>Cancel</Button>
              <Button
                className="flex-1"
                disabled={!form.name.trim() || createMutation.isPending || updateMutation.isPending}
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
