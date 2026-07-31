import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { Header } from "@/components/Header";
import {
  AlertTriangle, Package, Plus, Edit, Trash2, Tag, Search, X, IndianRupee,
} from "lucide-react";
import { AddInventoryModal } from "@/components/AddInventoryModal";
import { CategoriesTab } from "@/components/CategoriesTab";
import { Input } from "@/components/ui/input";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface InventoryItem {
  id: number;
  itemName: string;
  currentStock: string;
  minStock: string;
  unit: string;
  lastRestocked: string;
  categoryId: number | null;
  costPerUnit: string | null;
}

interface InventoryCategory {
  id: number;
  name: string;
  description?: string;
  displayOrder?: number;
}

type TabKey = "items" | "categories";

const UNCATEGORIZED = "uncategorized";

function getInitialTab(): TabKey {
  const params = new URLSearchParams(window.location.search);
  return params.get("tab") === "categories" ? "categories" : "items";
}

function parseError(err: any): string {
  const raw: string = err?.message ?? "";
  const jsonStart = raw.indexOf("{");
  if (jsonStart !== -1) {
    try {
      const parsed = JSON.parse(raw.slice(jsonStart));
      if (parsed?.message) return parsed.message;
    } catch {}
  }
  return raw || "Something went wrong";
}

export default function Inventory() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<TabKey>(getInitialTab);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [lowOnly, setLowOnly] = useState(false);
  const [negativeOnly, setNegativeOnly] = useState(false);

  const switchTab = (tab: TabKey) => {
    setActiveTab(tab);
    navigate(tab === "categories" ? "/inventory?tab=categories" : "/inventory", { replace: true });
  };

  const { data: inventory = [], isLoading } = useQuery<InventoryItem[]>({
    queryKey: ['/api/inventory'],
  });

  const { data: lowStockItems = [] } = useQuery<InventoryItem[]>({
    queryKey: ['/api/inventory/low-stock'],
  });

  const { data: negativeStockItems = [] } = useQuery<InventoryItem[]>({
    queryKey: ['/api/inventory/negative-stock'],
  });

  const { data: categories = [] } = useQuery<InventoryCategory[]>({
    queryKey: ['/api/inventory-categories'],
  });

  const getStockLevel = (current: number, min: number) => {
    const percentage = (current / (min * 2)) * 100;
    return Math.min(100, Math.max(0, percentage));
  };

  // 'negative' is distinct from 'low' — the count itself is known-wrong (an oversold
  // order was allowed rather than blocked; see reconcileOrderInventory) and needs a
  // physical recount, not just a reorder.
  const getStockStatus = (current: number, min: number) => {
    if (current < 0) return 'negative';
    if (current <= min) return 'low';
    if (current <= min * 1.5) return 'medium';
    return 'high';
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'negative': return 'bg-red-700';
      case 'low': return 'bg-red-500';
      case 'medium': return 'bg-yellow-500';
      case 'high': return 'bg-emerald-500';
      default: return 'bg-gray-500';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'negative': return 'Recount Needed';
      case 'low': return 'Low Stock';
      case 'medium': return 'Medium Stock';
      case 'high': return 'Good Stock';
      default: return 'Unknown';
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'negative': return 'bg-red-600 text-white';
      case 'low': return 'bg-red-100/80 text-red-700';
      case 'medium': return 'bg-yellow-100/80 text-yellow-700';
      case 'high': return 'bg-emerald-100/80 text-emerald-700';
      default: return 'bg-gray-100/80 text-gray-700';
    }
  };

  const getCategoryName = (categoryId: number | null) =>
    categories.find((c) => c.id === categoryId)?.name || null;

  const handleAddItem = () => { setEditingItem(null); setShowAddModal(true); };
  const handleEditItem = (item: InventoryItem) => { setEditingItem(item); setShowAddModal(true); };
  const handleCloseModal = () => { setShowAddModal(false); setEditingItem(null); };

  const deleteItemMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/inventory/${id}`),
    onSuccess: () => {
      toast({ title: "Item deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/low-stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/negative-stock"] });
    },
    onError: (err: any) => {
      toast({ title: "Failed to delete item", description: parseError(err), variant: "destructive" });
    },
  });

  const handleDeleteItem = (item: InventoryItem) => {
    if (confirm(`Delete "${item.itemName}" from inventory?`)) {
      deleteItemMutation.mutate(item.id);
    }
  };

  // ── Category counts + filter chips ──────────────────────────────────────────
  const categoryCounts = useMemo(() => {
    const counts = new Map<number, number>();
    let uncategorized = 0;
    for (const item of inventory) {
      if (item.categoryId != null) counts.set(item.categoryId, (counts.get(item.categoryId) ?? 0) + 1);
      else uncategorized++;
    }
    return { counts, uncategorized };
  }, [inventory]);

  const stockValue = useMemo(() => {
    let total = 0;
    let hasAny = false;
    for (const item of inventory) {
      if (item.costPerUnit) {
        hasAny = true;
        total += parseFloat(item.currentStock) * parseFloat(item.costPerUnit);
      }
    }
    return hasAny ? total : null;
  }, [inventory]);

  // ── Filtering ────────────────────────────────────────────────────────────────
  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return inventory.filter((item) => {
      if (negativeOnly && parseFloat(item.currentStock) >= 0) return false;
      if (lowOnly && parseFloat(item.currentStock) > parseFloat(item.minStock)) return false;
      if (filterCategory === UNCATEGORIZED && item.categoryId != null) return false;
      if (filterCategory !== "all" && filterCategory !== UNCATEGORIZED && item.categoryId !== Number(filterCategory)) return false;
      if (q) {
        const catName = getCategoryName(item.categoryId) || "";
        const haystack = `${item.itemName} ${catName} ${item.unit}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [inventory, searchQuery, filterCategory, lowOnly, negativeOnly, categories]);

  const clearFilters = () => { setSearchQuery(""); setFilterCategory("all"); setLowOnly(false); setNegativeOnly(false); };

  // Group into category buckets (only meaningful when "All" is selected)
  const groupedItems = useMemo(() => {
    if (filterCategory !== "all") return null;
    const groups: Array<{ key: string; label: string; items: InventoryItem[] }> = [];
    for (const cat of categories) {
      const items = filteredItems.filter((i) => i.categoryId === cat.id);
      if (items.length > 0) groups.push({ key: `cat-${cat.id}`, label: cat.name, items });
    }
    const uncategorized = filteredItems.filter((i) => i.categoryId == null);
    if (uncategorized.length > 0) groups.push({ key: "uncategorized", label: "Uncategorized", items: uncategorized });
    return groups;
  }, [filteredItems, categories, filterCategory]);

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 0 }).format(amount);

  const renderRow = (item: InventoryItem, i: number) => {
    const current = parseFloat(item.currentStock);
    const min = parseFloat(item.minStock);
    const status = getStockStatus(current, min);
    const stockLevel = getStockLevel(current, min);
    const catName = getCategoryName(item.categoryId);

    return (
      <motion.div
        key={item.id}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: Math.min(i, 20) * 0.02, duration: 0.15 }}
        className="rounded-xl bg-[var(--paper-0)] border border-[var(--line)] shadow-sm px-3 py-2.5
                   hover:border-emerald-300/60 transition-colors
                   sm:grid sm:grid-cols-[1.6fr_1fr_0.8fr_0.8fr_1.4fr_auto] sm:items-center sm:gap-3"
      >
        {/* Item name */}
        <div className="flex items-center justify-between sm:block min-w-0">
          <p className="font-medium text-sm text-gray-800 truncate">{item.itemName}</p>
          {/* Actions — shown inline on mobile, moved to the end column on desktop */}
          <div className="flex gap-1 flex-shrink-0 sm:hidden">
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={() => handleEditItem(item)}
              className="w-7 h-7 flex items-center justify-center rounded-xl bg-[var(--paper-0)] border border-[var(--line)] text-gray-500 hover:text-emerald-600 transition-all"
            >
              <Edit className="w-3 h-3" />
            </motion.button>
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={() => handleDeleteItem(item)}
              className="w-7 h-7 flex items-center justify-center rounded-xl bg-[var(--paper-0)] border border-[var(--line)] text-gray-500 hover:text-red-500 hover:bg-red-50/60 transition-all"
            >
              <Trash2 className="w-3 h-3" />
            </motion.button>
          </div>
        </div>

        {/* Mobile: category · stock · min · status, one line */}
        <p className="text-xs text-gray-500 mt-1 sm:hidden">
          {catName && <span className="text-emerald-700 font-medium">{catName}</span>}
          {catName && " · "}
          {current} {item.unit} · min {min} ·{" "}
          <span className={`font-semibold ${status === "negative" ? "text-red-700" : status === "low" ? "text-red-600" : status === "medium" ? "text-yellow-700" : "text-emerald-700"}`}>
            {getStatusText(status)}
          </span>
        </p>

        {/* Desktop columns */}
        <div className="hidden sm:block min-w-0">
          {catName ? (
            <span className="text-[11px] font-semibold bg-emerald-100/80 text-emerald-700 px-2.5 py-1 rounded-lg">
              {catName}
            </span>
          ) : (
            <span className="text-xs text-gray-400">—</span>
          )}
        </div>
        <div className="hidden sm:block text-sm font-semibold text-gray-700">{current} {item.unit}</div>
        <div className="hidden sm:block text-sm text-gray-500">{min} {item.unit}</div>
        <div className="hidden sm:block">
          <div className="flex items-center gap-2">
            <div className="h-1.5 flex-1 bg-[var(--paper-100)] rounded-full overflow-hidden border border-[var(--line)]">
              <div
                className={`h-full rounded-full transition-all ${getStatusColor(status)}`}
                style={{ width: `${stockLevel}%` }}
              />
            </div>
            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-lg whitespace-nowrap ${getStatusBadge(status)}`}>
              {getStatusText(status)}
            </span>
          </div>
        </div>
        <div className="hidden sm:flex gap-1 flex-shrink-0 justify-end">
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => handleEditItem(item)}
            className="w-7 h-7 flex items-center justify-center rounded-xl bg-[var(--paper-0)] border border-[var(--line)] text-gray-500 hover:text-emerald-600 transition-all"
          >
            <Edit className="w-3 h-3" />
          </motion.button>
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => handleDeleteItem(item)}
            className="w-7 h-7 flex items-center justify-center rounded-xl bg-[var(--paper-0)] border border-[var(--line)] text-gray-500 hover:text-red-500 hover:bg-red-50/60 transition-all"
          >
            <Trash2 className="w-3 h-3" />
          </motion.button>
        </div>
      </motion.div>
    );
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden bg-[var(--paper-50)]">
        <Header title="Inventory" description="Loading inventory..." />
        <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-6 space-y-1.5">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="h-12 rounded-xl bg-[var(--paper-100)] border border-[var(--line)] animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[var(--paper-50)]">
      <Header title="Inventory" description="Track stock levels and manage inventory items" />

      <main className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-6">
        {/* Tab Bar */}
        <div className="mb-6 flex items-center gap-1 p-1 rounded-xl bg-[var(--paper-100)] border border-[var(--line)] shadow-sm w-fit">
          <button
            onClick={() => switchTab("items")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
              activeTab === "items"
                ? "bg-gradient-to-r from-[#226B43] to-[#1B4D33] text-white shadow-sm"
                : "text-gray-600 hover:text-gray-900 hover:bg-[var(--paper-0)]"
            }`}
          >
            <Package className="w-4 h-4" /> Inventory Items
          </button>
          <button
            onClick={() => switchTab("categories")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
              activeTab === "categories"
                ? "bg-gradient-to-r from-[#226B43] to-[#1B4D33] text-white shadow-sm"
                : "text-gray-600 hover:text-gray-900 hover:bg-[var(--paper-0)]"
            }`}
          >
            <Tag className="w-4 h-4" /> Categories
          </button>
        </div>

        {activeTab === "categories" && (
          <CategoriesTab
            endpoint="/api/inventory-categories"
            queryKey="/api/inventory-categories"
            namePlaceholder="e.g. Rice, Oil, Vegetables, Dairy"
            dragHint="Drag rows to reorder. Item list reflects same order."
            deleteConfirm={(n) => `Delete category "${n}"? Its items become Uncategorized.`}
            alsoInvalidate={["/api/inventory"]}
          />
        )}

        {activeTab === "items" && (
          <>
            {/* Summary Strip */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4 sm:mb-6">
              {[
                {
                  label: "Total Items", value: inventory.length,
                  icon: <Package className="w-5 h-5 text-blue-500" />, color: "text-blue-600",
                  onClick: clearFilters, active: false,
                },
                {
                  label: "Low Stock", value: lowStockItems.length,
                  icon: <AlertTriangle className="w-5 h-5 text-red-500" />, color: "text-red-600",
                  onClick: () => setLowOnly((v) => !v), active: lowOnly,
                },
                ...(negativeStockItems.length > 0 ? [{
                  label: "Needs Reconciliation", value: negativeStockItems.length,
                  icon: <AlertTriangle className="w-5 h-5 text-red-700" />, color: "text-red-700",
                  onClick: () => setNegativeOnly((v) => !v), active: negativeOnly,
                }] : []),
                {
                  label: "Categories", value: categories.length,
                  icon: <Tag className="w-5 h-5 text-emerald-500" />, color: "text-emerald-600",
                  onClick: () => switchTab("categories"), active: false,
                },
                ...(stockValue != null ? [{
                  label: "Stock Value", value: formatCurrency(stockValue),
                  icon: <IndianRupee className="w-5 h-5 text-amber-500" />, color: "text-amber-600",
                  onClick: undefined, active: false,
                }] : []),
              ].map((stat, i) => (
                <motion.div
                  key={stat.label}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05, duration: 0.2 }}
                  onClick={stat.onClick}
                  className={`rounded-2xl bg-[var(--paper-100)] border shadow-md p-3.5 flex items-center justify-between transition-all ${
                    stat.onClick ? "cursor-pointer hover:bg-[var(--paper-0)]" : ""
                  } ${stat.active ? "border-red-300 ring-2 ring-red-200/60" : "border-[var(--line)]"}`}
                >
                  <div className="min-w-0">
                    <p className="text-xs text-gray-500 truncate">{stat.label}</p>
                    <p className={`text-xl font-bold mt-0.5 ${stat.color}`}>{stat.value}</p>
                  </div>
                  {stat.icon}
                </motion.div>
              ))}
            </div>

            {/* Search */}
            <div className="relative mb-3">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by item name, category, or unit…"
                className="pl-8 h-9 text-sm bg-[var(--paper-0)]"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery("")} className="absolute right-2.5 top-1/2 -translate-y-1/2">
                  <X className="w-3.5 h-3.5 text-gray-400" />
                </button>
              )}
            </div>

            {/* Category chips — horizontal scroll, shrink-0 (never flex-1 min-w-0, see CLAUDE.md) */}
            <div className="flex gap-2 overflow-x-auto pb-1 mb-4 -mx-1 px-1">
              <button
                onClick={() => setFilterCategory("all")}
                className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                  filterCategory === "all"
                    ? "bg-emerald-100/80 text-emerald-700"
                    : "bg-[var(--paper-0)] border border-[var(--line)] text-gray-600 hover:bg-[var(--paper-100)]"
                }`}
              >
                All ({inventory.length})
              </button>
              {categories.map((cat) => {
                const count = categoryCounts.counts.get(cat.id) ?? 0;
                return (
                  <button
                    key={cat.id}
                    onClick={() => setFilterCategory(cat.id.toString())}
                    className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                      filterCategory === cat.id.toString()
                        ? "bg-emerald-100/80 text-emerald-700"
                        : "bg-[var(--paper-0)] border border-[var(--line)] text-gray-600 hover:bg-[var(--paper-100)]"
                    }`}
                  >
                    {cat.name} ({count})
                  </button>
                );
              })}
              {categoryCounts.uncategorized > 0 && (
                <button
                  onClick={() => setFilterCategory(UNCATEGORIZED)}
                  className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                    filterCategory === UNCATEGORIZED
                      ? "bg-emerald-100/80 text-emerald-700"
                      : "bg-[var(--paper-0)] border border-[var(--line)] text-gray-600 hover:bg-[var(--paper-100)]"
                  }`}
                >
                  Uncategorized ({categoryCounts.uncategorized})
                </button>
              )}
            </div>

            {/* Toolbar */}
            <div className="mb-3 flex justify-between items-center">
              <p className="text-sm text-gray-500">
                {filteredItems.length} of {inventory.length} items
              </p>
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={handleAddItem}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold
                           bg-gradient-to-r from-[#226B43] to-[#1B4D33] text-white shadow-sm
                           hover:shadow-emerald-400/40 hover:shadow-md transition-all"
              >
                <Plus className="w-4 h-4" /> Add Item
              </motion.button>
            </div>

            {/* Column header — desktop only */}
            {filteredItems.length > 0 && (
              <div className="hidden sm:grid sm:grid-cols-[1.6fr_1fr_0.8fr_0.8fr_1.4fr_auto] sm:gap-3 px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                <span>Item</span>
                <span>Category</span>
                <span>Current</span>
                <span>Min</span>
                <span>Stock Level</span>
                <span className="text-right">Actions</span>
              </div>
            )}

            {/* Rows */}
            {groupedItems ? (
              <div className="space-y-4">
                {groupedItems.map((group) => (
                  <div key={group.key}>
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 px-1 mb-1.5">
                      {group.label} <span className="text-gray-400 font-normal normal-case">({group.items.length})</span>
                    </p>
                    <div className="space-y-1.5">
                      {group.items.map((item, i) => renderRow(item, i))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-1.5">
                {filteredItems.map((item, i) => renderRow(item, i))}
              </div>
            )}

            {inventory.length === 0 && (
              <div className="text-center py-16 rounded-2xl bg-[var(--paper-100)] border border-[var(--line)] mt-4">
                <Package className="w-10 h-10 mx-auto mb-3 text-gray-300" />
                <h3 className="text-base font-semibold text-gray-600 mb-1">No inventory items yet</h3>
                <p className="text-sm text-gray-400 mb-4">Start tracking by adding your first item</p>
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  onClick={handleAddItem}
                  className="px-4 py-2 rounded-xl text-sm font-semibold bg-gradient-to-r from-[#226B43] to-[#1B4D33] text-white shadow-sm hover:shadow-md transition-all"
                >
                  <Plus className="w-4 h-4 inline mr-1" /> Add First Item
                </motion.button>
              </div>
            )}

            {inventory.length > 0 && filteredItems.length === 0 && (
              <div className="text-center py-16 rounded-2xl bg-[var(--paper-100)] border border-[var(--line)] mt-4">
                <Search className="w-10 h-10 mx-auto mb-3 text-gray-300" />
                <h3 className="text-base font-semibold text-gray-600 mb-1">No items match</h3>
                <p className="text-sm text-gray-400 mb-4">Try a different search or clear your filters</p>
                <button
                  onClick={clearFilters}
                  className="px-4 py-2 rounded-xl text-sm font-semibold bg-[var(--paper-0)] border border-[var(--line)] text-gray-600 hover:bg-[var(--paper-100)] transition-all"
                >
                  Clear Filters
                </button>
              </div>
            )}
          </>
        )}
      </main>

      <AddInventoryModal
        isOpen={showAddModal}
        onClose={handleCloseModal}
        editItem={editingItem || undefined}
      />
    </div>
  );
}
