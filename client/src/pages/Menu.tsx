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
import { useToast } from "@/hooks/use-toast";

interface Category { id: number; name: string; description?: string; }
interface MenuItem {
  id: number; name: string; description?: string; price: string;
  categoryId: number; preparationTime: number; isAvailable: boolean;
  isVegetarian?: boolean; isSpicy?: boolean; allergens?: string;
  sizes?: Array<{ size: string; price: number }>;
  inventoryLinks?: Array<{ inventoryId: number; quantity: number }>;
}

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

  const { data: rawItems = [], isLoading } = useQuery<MenuItem[]>({
    queryKey: ["/api/menu?all=true"],
    queryFn: async () => {
      const res = await fetch("/api/menu?all=true", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });
  const { data: categories = [] } = useQuery<Category[]>({ queryKey: ["/api/categories"] });
  const { data: soldToday = {} } = useQuery<Record<number, number>>({
    queryKey: ["/api/menu/sold-today"], staleTime: 0, refetchInterval: 30000,
  });

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
    if (bulkPriceMode === "fixed") {
      bulkUpdateMutation.mutate({ ids, updates: { price: val.toString() } });
    } else {
      // percent: compute each item's new price individually
      const factor = 1 + val / 100;
      // Apply to each item separately (need their current prices)
      const itemsToUpdate = rawItems.filter((i) => ids.includes(i.id));
      Promise.all(
        itemsToUpdate.map((item) => {
          const newPrice = (getItemPrice(item) * factor).toFixed(2);
          return apiRequest("POST", "/api/menu/bulk-update", { ids: [item.id], updates: { price: newPrice } });
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

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-gradient-to-br from-slate-50 via-white to-emerald-50/30">
      <Header title="Menu" description="Manage your restaurant menu items and categories" />

      <main className="min-h-0 flex-1 overflow-y-auto p-6">
        {/* Tab Bar */}
        <div className="mb-6 flex items-center gap-1 p-1 rounded-xl bg-white/40 border border-white/30 shadow-sm w-fit">
          <button
            onClick={() => switchTab("items")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
              activeTab === "items"
                ? "bg-gradient-to-r from-emerald-500 to-green-500 text-white shadow-sm"
                : "text-gray-600 hover:text-gray-900 hover:bg-white/60"
            }`}
          >
            <UtensilsCrossed className="w-4 h-4" /> Menu Items
          </button>
          <button
            onClick={() => switchTab("categories")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
              activeTab === "categories"
                ? "bg-gradient-to-r from-emerald-500 to-green-500 text-white shadow-sm"
                : "text-gray-600 hover:text-gray-900 hover:bg-white/60"
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
                  <div key={i} className="h-44 rounded-2xl bg-white/40 border border-white/30 animate-pulse" />
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
                          : "bg-white/60 border-white/40 text-gray-600 hover:bg-white/80"
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
                          : "bg-white/60 border-white/40 text-gray-600 hover:bg-white/80"
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
                                 bg-gradient-to-r from-emerald-500 to-green-500 text-white shadow-sm
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
                      className="rounded-2xl bg-white/50 border border-white/40 shadow-sm p-4"
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
                              className="pl-8 h-8 text-sm bg-white/60"
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
                            <SelectTrigger className="h-8 text-sm bg-white/60">
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
                            <SelectTrigger className="h-8 text-sm bg-white/60">
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
                            <SelectTrigger className="h-7 text-xs w-36 bg-white/80">
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
                            <SelectTrigger className="h-7 text-xs w-24 bg-white/80">
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
                            className="h-7 text-xs w-24 bg-white/80"
                          />
                          <button
                            onClick={handleBulkPrice}
                            disabled={!bulkPriceValue || bulkUpdateMutation.isPending}
                            className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-purple-100 text-purple-700 hover:bg-purple-200 disabled:opacity-50 transition-colors"
                          >
                            Update
                          </button>
                        </div>

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
                        className={`rounded-2xl bg-white/40 border shadow-md p-4
                                   hover:scale-[1.01] hover:shadow-xl hover:shadow-emerald-500/10 hover:bg-white/50
                                   transition-all duration-200 ${
                          bulkMode ? "cursor-pointer" : ""
                        } ${
                          isSelected
                            ? "border-emerald-400 bg-emerald-50/40 ring-2 ring-emerald-300/50"
                            : "border-white/30"
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
                                className="w-7 h-7 flex items-center justify-center rounded-xl bg-white/60 border border-white/40 text-gray-500 hover:text-emerald-600 hover:bg-white/80 transition-all"
                              >
                                <Edit className="w-3 h-3" />
                              </motion.button>
                              <motion.button
                                whileTap={{ scale: 0.9 }}
                                onClick={() => handleDeleteItem(item)}
                                disabled={deleteMenuItemMutation.isPending}
                                className="w-7 h-7 flex items-center justify-center rounded-xl bg-white/60 border border-white/40 text-gray-500 hover:text-red-500 hover:bg-red-50/60 transition-all"
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

                        <div className="mt-3 flex justify-between text-xs text-gray-400 border-t border-white/40 pt-2">
                          <span>Prep: {item.preparationTime}min</span>
                          <div className="flex items-center gap-2">
                            {item.inventoryLinks && item.inventoryLinks.length > 0 && (
                              <span className="text-blue-400 font-medium">{item.inventoryLinks.length} ingredient{item.inventoryLinks.length > 1 ? "s" : ""}</span>
                            )}
                            <span>Sold today: {soldToday[item.id] ?? 0}</span>
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>

                {menuItems.length === 0 && (
                  <div className="text-center py-16 rounded-2xl bg-white/30 border border-white/30 mt-4">
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
                          className="px-4 py-2 rounded-xl text-sm font-semibold bg-gradient-to-r from-emerald-500 to-green-500 text-white shadow-sm hover:shadow-md transition-all"
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
    </div>
  );
}
