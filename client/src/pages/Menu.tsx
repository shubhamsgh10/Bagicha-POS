import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Header } from "@/components/Header";
import { Badge } from "@/components/ui/badge";
import { Plus, Edit, Trash2 } from "lucide-react";
import { AddMenuItemModal } from "@/components/AddMenuItemModal";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface Category { id: number; name: string; description?: string; }
interface MenuItem {
  id: number; name: string; description?: string; price: string;
  categoryId: number; preparationTime: number; isAvailable: boolean;
  isVegetarian?: boolean; isSpicy?: boolean; allergens?: string;
  sizes?: Array<{ size: string; price: number }>;
}

export default function Menu() {
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const { data: menuItems = [], isLoading } = useQuery<MenuItem[]>({ queryKey: ['/api/menu'] });
  const { data: categories = [] } = useQuery<Category[]>({ queryKey: ['/api/categories'] });
  const { data: soldToday = {} } = useQuery<Record<number, number>>({
    queryKey: ['/api/menu/sold-today'], staleTime: 0, refetchInterval: 30000,
  });

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0 }).format(amount);

  const getCategoryName = (categoryId: number) =>
    categories.find((cat) => cat.id === categoryId)?.name || 'Unknown';

  const handleAddItem  = () => { setEditingItem(null); setShowAddModal(true); };
  const handleEditItem = (item: MenuItem) => { setEditingItem(item); setShowAddModal(true); };
  const handleCloseModal = () => { setShowAddModal(false); setEditingItem(null); };

  const deleteMenuItemMutation = useMutation({
    mutationFn: async (id: number) => apiRequest('DELETE', `/api/menu/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/menu'] }),
  });

  const handleDeleteItem = (item: MenuItem) => {
    if (window.confirm(`Delete "${item.name}"?`)) deleteMenuItemMutation.mutate(item.id);
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden bg-gradient-to-br from-slate-50 via-white to-emerald-50/30">
        <Header title="Menu" description="Loading menu items..." />
        <div className="min-h-0 flex-1 overflow-y-auto p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-44 rounded-2xl bg-white/40 border border-white/30 backdrop-blur-sm animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-gradient-to-br from-slate-50 via-white to-emerald-50/30">
      <Header title="Menu" description="Manage your restaurant menu items and categories" />

      <main className="min-h-0 flex-1 overflow-y-auto p-6">
        {/* Toolbar */}
        <div className="mb-6 flex justify-between items-center">
          <div>
            <h2 className="text-xl font-semibold text-gray-800">Menu Items</h2>
            <p className="text-sm text-gray-500">{menuItems.length} items available</p>
          </div>
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={handleAddItem}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold
                       bg-gradient-to-r from-emerald-500 to-green-500 text-white shadow-sm
                       hover:shadow-emerald-400/40 hover:shadow-md transition-all"
          >
            <Plus className="w-4 h-4" /> Add Menu Item
          </motion.button>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {menuItems.map((item, i) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04, duration: 0.2 }}
              className="rounded-2xl backdrop-blur-lg bg-white/40 border border-white/30 shadow-md p-4
                         hover:scale-[1.01] hover:shadow-xl hover:shadow-emerald-500/10 hover:bg-white/50
                         transition-all duration-200"
            >
              <div className="flex justify-between items-start mb-3">
                <span className="text-[11px] font-semibold bg-emerald-100/80 text-emerald-700 px-2.5 py-1 rounded-lg backdrop-blur-sm">
                  {getCategoryName(item.categoryId)}
                </span>
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
                <span>Sold today: {soldToday[item.id] ?? 0}</span>
              </div>
            </motion.div>
          ))}
        </div>

        {menuItems.length === 0 && (
          <div className="text-center py-16 rounded-2xl bg-white/30 backdrop-blur-sm border border-white/30 mt-4">
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
          </div>
        )}
      </main>

      <AddMenuItemModal isOpen={showAddModal} onClose={handleCloseModal} editItem={editingItem || undefined} />
    </div>
  );
}
