import { apiUrl } from '@/lib/api';
import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { Header } from "@/components/Header";
import {
  Plus, Edit, Trash2, UtensilsCrossed, Tag, Search, X, Filter,
  CheckSquare, Square, ChevronDown, AlertTriangle,
} from "lucide-react";
import { AddMenuItemModal } from "@/components/AddMenuItemModal";
import { CategoriesTab } from "@/components/CategoriesTab";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useRole } from "@/hooks/useRole";
import { computeMenuItemCost, computeMarginPercent } from "@shared/menuCost";

interface Category { id: number; name: string; description?: string; }
interface MenuItem {
  id: number; name: string; description?: string; price: string;
  categoryId: number; preparationTime: number; isAvailable: boolean;
  isVegetarian?: boolean; isSpicy?: boolean; allergens?: string;
  sizes?: Array<{ size: string; price: number; stockMultiplier?: number }>;
  inventoryLinks?: Array<{ inventoryId: number; quantity: number }>;
  addonsEnabled?: boolean;
  addons?: Array<{ name: string; price: number }>;
}

interface AddonEntry { name: string; price: string; }

type TabKey = "items" | "categories";

function getInitialTab(): TabKey {
  const params = new URLSearchParams(window.location.search);
  return params.get("tab") === "categories" ? "categories" : "items";
}

export default function Menu() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<TabKey>(getInitialTab);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);

  // ── Filters ──────────────────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState("");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [filterAvailability, setFilterAvailability] = useState<string>("all");
  const [priceRange, setPriceRange] = useState<[number, number]>([0, 10000]);
  const [showFilters, setShowFilters] = useState(false);

  // ── Bulk select ───────────────────────────────────────────────────────────────
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // Bulk action state
  const [bulkCategoryId, setBulkCategoryId] = useState<string>("");
  const [bulkPriceMode, setBulkPriceMode] = useState<"fixed" | "percent">("fixed");
  const [bulkPriceValue, setBulkPriceValue] = useState("");
  const [showBulkAddonsDialog, setShowBulkAddonsDialog] = useState(false);
  const [bulkAddonsList, setBulkAddonsList] = useState<AddonEntry[]>([{ name: "", price: "" }]);

  const { data: rawItems = [], isLoading } = useQuery<MenuItem[]>({
    queryKey: ["/api/menu?all=true"],
    queryFn: async () => {
      const res = await fetch(apiUrl("/api/menu?all=true"), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });
  const { data: categories = [] } = useQuery<Category[]>({ queryKey: ["/api/categories"] });
  const { data: soldToday = {} } = useQuery<Record<number, number>>({
    queryKey: ["/api/menu/sold-today"], staleTime: 0, refetchInterval: 30000,
  });

  // Cost/margin is sensitive business data (same tier as payroll — see CLAUDE.md's
  // requireManagerOrAdmin note) — only fetched and shown to manager/admin, never staff.
  const role = useRole();
  const canSeeCost = role === "admin" || role === "manager";
  const { data: inventoryItems = [] } = useQuery<any[]>({
    queryKey: ["/api/inventory"],
    enabled: canSeeCost,
  });
  const costByInventoryId = useMemo(
    () => new Map<number, string | null>(inventoryItems.map((inv: any) => [inv.id, inv.costPerUnit])),
    [inventoryItems]
  );

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 0 }).format(amount);

  const getCategoryName = (categoryId: number) =>
    categories.find((cat) => cat.id === categoryId)?.name || "Unknown";

  const getItemPrice = (item: MenuItem): number => {
    if (item.sizes && item.sizes.length > 0) return Math.min(...item.sizes.map((s) => s.price));
    return parseFloat(item.price) || 0;
  };

  // Compute max price for slider
  const maxPrice = useMemo(() => {
    const prices = rawItems.map(getItemPrice);
    return Math.max(1000, ...prices);
  }, [rawItems]);

  // Apply filters
  const menuItems = useMemo(() => {
    return rawItems.filter((item) => {
      if (searchQuery && !item.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      if (filterCategory !== "all" && item.categoryId !== Number(filterCategory)) return false;
      if (filterAvailability === "available" && !item.isAvailable) return false;
      if (filterAvailability === "unavailable" && item.isAvailable) return false;
      const price = getItemPrice(item);
      if (price < priceRange[0] || price > priceRange[1]) return false;
      return true;
    });
  }, [rawItems, searchQuery, filterCategory, filterAvailability, priceRange]);

  const hasActiveFilters = searchQuery || filterCategory !== "all" || filterAvailability !== "all"
    || priceRange[0] > 0 || priceRange[1] < maxPrice;

  const clearFilters = () => {
    setSearchQuery("");
    setFilterCategory("all");
    setFilterAvailability("all");
    setPriceRange([0, maxPrice]);
  };

  // ── Mutations ─────────────────────────────────────────────────────────────────
  const deleteMenuItemMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/menu/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/menu?all=true"] }),
  });

  const bulkUpdateMutation = useMutation({
    mutationFn: async (payload: { ids: number[]; updates: any }) =>
      apiRequest("POST", "/api/menu/bulk-update", payload),
    onSuccess: (_, vars) => {
      toast({ title: `Updated ${vars.ids.length} item(s)` });
      queryClient.invalidateQueries({ queryKey: ["/api/menu?all=true"] });
      setSelectedIds(new Set());
    },
    onError: () => toast({ title: "Bulk update failed", variant: "destructive" }),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: number[]) => apiRequest("POST", "/api/menu/bulk-delete", { ids }),
    onSuccess: (_, ids) => {
      toast({ title: `Deleted ${ids.length} item(s)` });
      queryClient.invalidateQueries({ queryKey: ["/api/menu?all=true"] });
      setSelectedIds(new Set());
      setBulkMode(false);
    },
    onError: () => toast({ title: "Bulk delete failed", variant: "destructive" }),
  });

  const handleAddItem = () => { setEditingItem(null); setShowAddModal(true); };
  const handleEditItem = (item: MenuItem) => { setEditingItem(item); setShowAddModal(true); };
  const handleCloseModal = () => {
    setShowAddModal(false);
    setEditingItem(null);
    queryClient.invalidateQueries({ queryKey: ["/api/menu?all=true"] });
  };

  const handleDeleteItem = (item: MenuItem) => {
    if (window.confirm(`Delete "${item.name}"?`)) deleteMenuItemMutation.mutate(item.id);
  };

  const switchTab = (tab: TabKey) => {
    setActiveTab(tab);
    navigate(tab === "categories" ? "/menu?tab=categories" : "/menu", { replace: true });
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === menuItems.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(menuItems.map((i) => i.id)));
    }
  };

  const handleBulkAvailability = (available: boolean) => {
    bulkUpdateMutation.mutate({ ids: Array.from(selectedIds), updates: { isAvailable: available } });
  };

  const handleBulkCategory = () => {
    if (!bulkCategoryId) return;
    bulkUpdateMutation.mutate({ ids: Array.from(selectedIds), updates: { categoryId: Number(bulkCategoryId) } });
    setBulkCategoryId("");
  };

  const handleBulkPrice = () => {
    const val = parseFloat(bulkPriceValue);
    if (isNaN(val) || val < 0) return toast({ title: "Invalid value", variant: "destructive" });
    const ids = Array.from(selectedIds);
    const itemsToUpdate = rawItems.filter((i) => ids.includes(i.id));
    // A size-priced item's real sale price is sizes[].price, never the base `price`
    // field (shared/orderPricing.ts's floor logic ignores base price once a size
    // matches) — bulk price updates used to only ever send `price`, so they silently
    // no-op for every sized item (e.g. "Cold Coffee" Regular/Large) while the mutation
    // still reported success. Split sized vs plain items and handle each correctly.
    const sizedItems = itemsToUpdate.filter((i) => i.sizes && i.sizes.length > 0);
    const plainItems = itemsToUpdate.filter((i) => !(i.sizes && i.sizes.length > 0));

    if (bulkPriceMode === "fixed") {
      // One absolute price doesn't map cleanly onto a multi-size item (which size
      // would get it?) — apply only to plain items and tell the admin the rest need
      // editing individually, instead of silently doing nothing for them. Bypasses
      // bulkUpdateMutation's own success toast (same reason the % branch below does)
      // so there's exactly one combined toast, not a race between two.
      const request = plainItems.length > 0
        ? apiRequest("POST", "/api/menu/bulk-update", { ids: plainItems.map((i) => i.id), updates: { price: val.toString() } })
        : Promise.resolve();
      request.then(() => {
        if (sizedItems.length > 0) {
          toast({
            title: plainItems.length > 0
              ? `Updated ${plainItems.length} item(s) — skipped ${sizedItems.length} multi-size item(s)`
              : `Skipped ${sizedItems.length} multi-size item(s)`,
            description: "Multi-size items need a fixed price per size — edit them individually, or use the % option.",
          });
        } else {
          toast({ title: `Updated ${plainItems.length} item(s)` });
        }
        queryClient.invalidateQueries({ queryKey: ["/api/menu?all=true"] });
        setSelectedIds(new Set());
      }).catch(() => toast({ title: "Price update failed", variant: "destructive" }));
    } else {
      // percent: compute each item's new price individually, including every size.
      const factor = 1 + val / 100;
      Promise.all(
        itemsToUpdate.map((item) => {
          const hasSizes = item.sizes && item.sizes.length > 0;
          const updates: any = { price: (getItemPrice(item) * factor).toFixed(2) };
          if (hasSizes) {
            updates.sizes = item.sizes!.map((s) => ({
              ...s,
              price: Number((s.price * factor).toFixed(2)),
            }));
          }
          return apiRequest("POST", "/api/menu/bulk-update", { ids: [item.id], updates });
        })
      ).then(() => {
        toast({ title: `Updated prices for ${ids.length} item(s)` });
        queryClient.invalidateQueries({ queryKey: ["/api/menu?all=true"] });
        setSelectedIds(new Set());
      }).catch(() => toast({ title: "Price update failed", variant: "destructive" }));
    }
    setBulkPriceValue("");
  };

  const handleBulkDelete = () => {
    if (window.confirm(`Delete ${selectedIds.size} item(s)? This action cannot be undone.`)) {
      bulkDeleteMutation.mutate(Array.from(selectedIds));
    }
  };

  // ── Bulk add-ons ──────────────────────────────────────────────────────────────
  // Merges (upserts by name) into each selected item's own addons list, rather than
  // overwriting it — items in a bulk selection can already carry different addons.
  const addBulkAddonRow = () => setBulkAddonsList((prev) => [...prev, { name: "", price: "" }]);
  const removeBulkAddonRow = (idx: number) =>
    setBulkAddonsList((prev) => prev.filter((_, i) => i !== idx));
  const updateBulkAddonRow = (idx: number, field: keyof AddonEntry, value: string) =>
    setBulkAddonsList((prev) => prev.map((a, i) => (i === idx ? { ...a, [field]: value } : a)));

  const bulkAddonsValid = bulkAddonsList.some(
    (a) => a.name.trim().length > 0 && a.price.trim().length > 0 && !isNaN(parseFloat(a.price))
  );

  const handleBulkAddons = () => {
    const newAddons = bulkAddonsList
      .filter((a) => a.name.trim() && !isNaN(parseFloat(a.price)))
      .map((a) => ({ name: a.name.trim(), price: parseFloat(a.price) }));
    if (newAddons.length === 0) return;

    const ids = Array.from(selectedIds);
    const itemsToUpdate = rawItems.filter((i) => ids.includes(i.id));

    Promise.all(
      itemsToUpdate.map((item) => {
        const merged = Array.isArray(item.addons) ? [...item.addons] : [];
        for (const na of newAddons) {
          const idx = merged.findIndex((e) => e.name.trim().toLowerCase() === na.name.toLowerCase());
          if (idx >= 0) merged[idx] = { ...merged[idx], price: na.price };
          else merged.push(na);
        }
        return apiRequest("POST", "/api/menu/bulk-update", {
          ids: [item.id],
          updates: { addonsEnabled: true, addons: merged },
        });
      })
    )
      .then(() => {
        toast({ title: `Added add-ons to ${ids.length} item(s)` });
        queryClient.invalidateQueries({ queryKey: ["/api/menu?all=true"] });
        setSelectedIds(new Set());
        setShowBulkAddonsDialog(false);
        setBulkAddonsList([{ name: "", price: "" }]);
      })
      .catch(() => toast({ title: "Bulk add-ons update failed", variant: "destructive" }));
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[var(--paper-50)]">
      <Header title="Menu" description="Manage your restaurant menu items and categories" />

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
            <UtensilsCrossed className="w-4 h-4" /> Menu Items
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

        {/* ── Menu Items Tab ── */}
        {activeTab === "items" && (
          <>
            {isLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="h-44 rounded-2xl bg-[var(--paper-100)] border border-[var(--line)] animate-pulse" />
                ))}
              </div>
            ) : (
              <>
                {/* Toolbar */}
                <div className="mb-4 flex flex-wrap justify-between items-center gap-3">
                  <div>
                    <h2 className="text-xl font-semibold text-gray-800">Menu Items</h2>
                    <p className="text-sm text-gray-500">
                      {menuItems.length} of {rawItems.length} items
                      {hasActiveFilters && " (filtered)"}
                    </p>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <motion.button
                      whileTap={{ scale: 0.95 }}
                      onClick={() => { setBulkMode((v) => !v); setSelectedIds(new Set()); }}
                      className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold transition-all border ${
                        bulkMode
                          ? "bg-amber-50 border-amber-300 text-amber-700"
                          : "bg-[var(--paper-0)] border-[var(--line)] text-gray-600 hover:bg-[var(--paper-0)]"
                      }`}
                    >
                      <CheckSquare className="w-4 h-4" />
                      {bulkMode ? "Exit Bulk" : "Bulk Edit"}
                    </motion.button>
                    <motion.button
                      whileTap={{ scale: 0.95 }}
                      onClick={() => setShowFilters((v) => !v)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold transition-all border ${
                        showFilters || hasActiveFilters
                          ? "bg-emerald-50 border-emerald-300 text-emerald-700"
                          : "bg-[var(--paper-0)] border-[var(--line)] text-gray-600 hover:bg-[var(--paper-0)]"
                      }`}
                    >
                      <Filter className="w-4 h-4" /> Filters
                      {hasActiveFilters && (
                        <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
                      )}
                    </motion.button>
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
                </div>

                {/* ── Search + Filters Panel ── */}
                {/* grid-template-rows trick: pure CSS height expand, no JS layout thrash */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateRows: showFilters ? "1fr" : "0fr",
                    transition: "grid-template-rows 0.22s cubic-bezier(0.4,0,0.2,1)",
                  }}
                  className={showFilters ? "mb-5" : ""}
                >
                  <div className="min-h-0 overflow-hidden">
                    <div
                      style={{
                        opacity: showFilters ? 1 : 0,
                        transform: showFilters ? "translateY(0)" : "translateY(-6px)",
                        transition: "opacity 0.18s ease, transform 0.18s ease",
                      }}
                      className="rounded-2xl bg-[var(--paper-0)] border border-[var(--line)] shadow-sm p-4"
                    >
                      <div className="flex flex-wrap gap-4 items-end">
                        {/* Search */}
                        <div className="flex-1 min-w-48">
                          <label className="text-xs font-medium text-gray-500 mb-1 block">Search</label>
                          <div className="relative">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                            <Input
                              value={searchQuery}
                              onChange={(e) => setSearchQuery(e.target.value)}
                              placeholder="Item name…"
                              className="pl-8 h-8 text-sm bg-[var(--paper-0)]"
                            />
                            {searchQuery && (
                              <button onClick={() => setSearchQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2">
                                <X className="w-3 h-3 text-gray-400" />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Category */}
                        <div className="min-w-40">
                          <label className="text-xs font-medium text-gray-500 mb-1 block">Category</label>
                          <Select value={filterCategory} onValueChange={setFilterCategory}>
                            <SelectTrigger className="h-8 text-sm bg-[var(--paper-0)]">
                              <SelectValue placeholder="All categories" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">All Categories</SelectItem>
                              {categories.map((c) => (
                                <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        {/* Availability */}
                        <div className="min-w-36">
                          <label className="text-xs font-medium text-gray-500 mb-1 block">Availability</label>
                          <Select value={filterAvailability} onValueChange={setFilterAvailability}>
                            <SelectTrigger className="h-8 text-sm bg-[var(--paper-0)]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">All</SelectItem>
                              <SelectItem value="available">Available</SelectItem>
                              <SelectItem value="unavailable">Out of Stock</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        {/* Price range */}
                        <div className="min-w-52 flex-1">
                          <label className="text-xs font-medium text-gray-500 mb-1 block">
                            Price: {formatCurrency(priceRange[0])} – {formatCurrency(priceRange[1])}
                          </label>
                          <Slider
                            min={0}
                            max={maxPrice}
                            step={10}
                            value={priceRange}
                            onValueChange={(v) => setPriceRange(v as [number, number])}
                            className="mt-2"
                          />
                        </div>

                        {hasActiveFilters && (
                          <button
                            onClick={clearFilters}
                            className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 font-medium whitespace-nowrap"
                          >
                            <X className="w-3 h-3" /> Clear Filters
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* ── Bulk Actions Panel ── */}
                <AnimatePresence>
                  {bulkMode && selectedIds.size > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      className="mb-5 rounded-2xl bg-amber-50/80 border border-amber-200 shadow-sm p-4"
                    >
                      <div className="flex flex-wrap gap-3 items-center">
                        <span className="text-sm font-semibold text-amber-800">
                          {selectedIds.size} item{selectedIds.size > 1 ? "s" : ""} selected
                        </span>

                        {/* Availability */}
                        <button
                          onClick={() => handleBulkAvailability(true)}
                          disabled={bulkUpdateMutation.isPending}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-green-100 text-green-700 hover:bg-green-200 transition-colors"
                        >
                          Mark Available
                        </button>
                        <button
                          onClick={() => handleBulkAvailability(false)}
                          disabled={bulkUpdateMutation.isPending}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-100 text-red-700 hover:bg-red-200 transition-colors"
                        >
                          Mark Unavailable
                        </button>

                        {/* Change category */}
                        <div className="flex items-center gap-1.5">
                          <Select value={bulkCategoryId} onValueChange={setBulkCategoryId}>
                            <SelectTrigger className="h-7 text-xs w-36 bg-[var(--paper-0)]">
                              <SelectValue placeholder="Change category" />
                            </SelectTrigger>
                            <SelectContent>
                              {categories.map((c) => (
                                <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <button
                            onClick={handleBulkCategory}
                            disabled={!bulkCategoryId || bulkUpdateMutation.isPending}
                            className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-blue-100 text-blue-700 hover:bg-blue-200 disabled:opacity-50 transition-colors"
                          >
                            Apply
                          </button>
                        </div>

                        {/* Price update */}
                        <div className="flex items-center gap-1.5">
                          <Select value={bulkPriceMode} onValueChange={(v: any) => setBulkPriceMode(v)}>
                            <SelectTrigger className="h-7 text-xs w-24 bg-[var(--paper-0)]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="fixed">Set ₹</SelectItem>
                              <SelectItem value="percent">Change %</SelectItem>
                            </SelectContent>
                          </Select>
                          <Input
                            type="number"
                            value={bulkPriceValue}
                            onChange={(e) => setBulkPriceValue(e.target.value)}
                            placeholder={bulkPriceMode === "fixed" ? "e.g. 150" : "e.g. 10"}
                            className="h-7 text-xs w-24 bg-[var(--paper-0)]"
                          />
                          <button
                            onClick={handleBulkPrice}
                            disabled={!bulkPriceValue || bulkUpdateMutation.isPending}
                            className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-purple-100 text-purple-700 hover:bg-purple-200 disabled:opacity-50 transition-colors"
                          >
                            Update
                          </button>
                        </div>

                        {/* Add-ons */}
                        <button
                          onClick={() => setShowBulkAddonsDialog(true)}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-100 text-amber-700 hover:bg-amber-200 transition-colors"
                        >
                          Add-ons
                        </button>

                        {/* Delete */}
                        <button
                          onClick={handleBulkDelete}
                          disabled={bulkDeleteMutation.isPending}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-500 text-white hover:bg-red-600 transition-colors ml-auto"
                        >
                          <Trash2 className="w-3 h-3" /> Delete Selected
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Bulk mode: select all row */}
                {bulkMode && menuItems.length > 0 && (
                  <div className="mb-3 flex items-center gap-2 px-1">
                    <button onClick={toggleSelectAll} className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900">
                      {selectedIds.size === menuItems.length
                        ? <CheckSquare className="w-4 h-4 text-emerald-600" />
                        : <Square className="w-4 h-4" />}
                      Select all {menuItems.length} visible
                    </button>
                  </div>
                )}

                {/* Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                  {menuItems.map((item, i) => {
                    const isSelected = selectedIds.has(item.id);
                    return (
                      <motion.div
                        key={item.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.03, duration: 0.2 }}
                        onClick={bulkMode ? () => toggleSelect(item.id) : undefined}
                        className={`rounded-2xl bg-[var(--paper-100)] border shadow-md p-4
                                   hover:scale-[1.01] hover:shadow-xl hover:shadow-emerald-500/10 hover:bg-[var(--paper-0)]
                                   transition-all duration-200 ${
                          bulkMode ? "cursor-pointer" : ""
                        } ${
                          isSelected
                            ? "border-emerald-400 bg-emerald-50/40 ring-2 ring-emerald-300/50"
                            : "border-[var(--line)]"
                        }`}
                      >
                        <div className="flex justify-between items-start mb-3">
                          <div className="flex items-center gap-2">
                            {bulkMode && (
                              <div className="flex-shrink-0">
                                {isSelected
                                  ? <CheckSquare className="w-4 h-4 text-emerald-600" />
                                  : <Square className="w-4 h-4 text-gray-300" />}
                              </div>
                            )}
                            <span className="text-[11px] font-semibold bg-emerald-100/80 text-emerald-700 px-2.5 py-1 rounded-lg">
                              {getCategoryName(item.categoryId)}
                            </span>
                          </div>
                          {!bulkMode && (
                            <div className="flex gap-1.5">
                              <motion.button
                                whileTap={{ scale: 0.9 }}
                                onClick={() => handleEditItem(item)}
                                className="w-7 h-7 flex items-center justify-center rounded-xl bg-[var(--paper-0)] border border-[var(--line)] text-gray-500 hover:text-emerald-600 hover:bg-[var(--paper-0)] transition-all"
                              >
                                <Edit className="w-3 h-3" />
                              </motion.button>
                              <motion.button
                                whileTap={{ scale: 0.9 }}
                                onClick={() => handleDeleteItem(item)}
                                disabled={deleteMenuItemMutation.isPending}
                                className="w-7 h-7 flex items-center justify-center rounded-xl bg-[var(--paper-0)] border border-[var(--line)] text-gray-500 hover:text-red-500 hover:bg-red-50/60 transition-all"
                              >
                                <Trash2 className="w-3 h-3" />
                              </motion.button>
                            </div>
                          )}
                        </div>

                        <h3 className="font-semibold text-gray-800 mb-1">{item.name}</h3>
                        {item.description && <p className="text-xs text-gray-500 mb-2 line-clamp-2">{item.description}</p>}

                        <div className="flex justify-between items-center mt-2">
                          {item.sizes && item.sizes.length > 0 ? (
                            <div className="flex flex-wrap gap-x-2 gap-y-1 text-xs">
                              {item.sizes.map((s) => (
                                <span key={s.size}>
                                  <span className="text-gray-400">{s.size} </span>
                                  <span className="font-bold text-gray-700">{formatCurrency(s.price)}</span>
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-lg font-bold text-gray-800">{formatCurrency(parseFloat(item.price))}</span>
                          )}
                          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-lg ${item.isAvailable ? "bg-green-100/80 text-green-700" : "bg-red-100/80 text-red-600"}`}>
                            {item.isAvailable ? "Available" : "Out of Stock"}
                          </span>
                        </div>

                        <div className="mt-3 flex justify-between text-xs text-gray-400 border-t border-[var(--line)] pt-2">
                          <span>Prep: {item.preparationTime}min</span>
                          <div className="flex items-center gap-2">
                            {item.inventoryLinks && item.inventoryLinks.length > 0 && (
                              <span className="text-blue-400 font-medium">{item.inventoryLinks.length} ingredient{item.inventoryLinks.length > 1 ? "s" : ""}</span>
                            )}
                            {canSeeCost && item.inventoryLinks && item.inventoryLinks.length > 0 && (() => {
                              // Base-recipe cost (no size multiplier) against the card's displayed
                              // price — an approximation for pizzas (which show a min-size price);
                              // AddMenuItemModal shows the accurate per-size breakdown for editing.
                              const result = computeMenuItemCost(item.inventoryLinks, costByInventoryId, 1);
                              if (result.hasIncompleteCost) {
                                return <span className="text-gray-400" title="Some linked ingredients have no cost/unit set">Margin: —</span>;
                              }
                              const margin = computeMarginPercent(parseFloat(item.price), result.cost);
                              if (margin == null) return null;
                              return (
                                <span className={`font-medium ${margin < 20 ? "text-red-500" : margin < 40 ? "text-amber-600" : "text-emerald-600"}`}>
                                  Margin: {margin.toFixed(0)}%
                                </span>
                              );
                            })()}
                            <span>Sold today: {soldToday[item.id] ?? 0}</span>
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>

                {menuItems.length === 0 && (
                  <div className="text-center py-16 rounded-2xl bg-[var(--paper-100)] border border-[var(--line)] mt-4">
                    {hasActiveFilters ? (
                      <>
                        <Search className="w-10 h-10 mx-auto mb-3 text-gray-300" />
                        <h3 className="text-base font-semibold text-gray-600 mb-1">No items match your filters</h3>
                        <button onClick={clearFilters} className="text-sm text-emerald-600 hover:underline mt-1">
                          Clear filters
                        </button>
                      </>
                    ) : (
                      <>
                        <Plus className="w-10 h-10 mx-auto mb-3 text-gray-300" />
                        <h3 className="text-base font-semibold text-gray-600 mb-1">No menu items yet</h3>
                        <p className="text-sm text-gray-400 mb-4">Get started by adding your first menu item</p>
                        <motion.button
                          whileTap={{ scale: 0.95 }}
                          onClick={handleAddItem}
                          className="px-4 py-2 rounded-xl text-sm font-semibold bg-gradient-to-r from-[#226B43] to-[#1B4D33] text-white shadow-sm hover:shadow-md transition-all"
                        >
                          <Plus className="w-4 h-4 inline mr-1" /> Add Menu Item
                        </motion.button>
                      </>
                    )}
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* ── Categories Tab ── */}
        {activeTab === "categories" && <CategoriesTab />}
      </main>

      <AddMenuItemModal isOpen={showAddModal} onClose={handleCloseModal} editItem={editingItem || undefined} />

      <Dialog open={showBulkAddonsDialog} onOpenChange={setShowBulkAddonsDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add-ons for {selectedIds.size} item{selectedIds.size > 1 ? "s" : ""}</DialogTitle>
            <DialogDescription>
              These add-ons are merged into each selected item's existing list (updated if the name already exists, added otherwise) — nothing else on the item changes.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            {bulkAddonsList.map((addon, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <Input
                  placeholder="Addon name (e.g. Extra Cheese)"
                  value={addon.name}
                  onChange={(e) => updateBulkAddonRow(idx, "name", e.target.value)}
                  className="flex-1"
                />
                <div className="flex items-center gap-1 w-28">
                  <span className="text-sm text-muted-foreground">₹</span>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0"
                    value={addon.price}
                    onChange={(e) => updateBulkAddonRow(idx, "price", e.target.value)}
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeBulkAddonRow(idx)}
                  disabled={bulkAddonsList.length === 1}
                  className="text-destructive hover:text-destructive"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ))}

            <Button type="button" variant="outline" size="sm" onClick={addBulkAddonRow}>
              <Plus className="w-4 h-4 mr-1" />
              Add Another
            </Button>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setShowBulkAddonsDialog(false)}>Cancel</Button>
            <Button onClick={handleBulkAddons} disabled={!bulkAddonsValid}>
              Apply to {selectedIds.size} item{selectedIds.size > 1 ? "s" : ""}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
