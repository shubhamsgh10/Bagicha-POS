import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Header } from "@/components/Header";
import { AlertTriangle, Package, Plus, Edit } from "lucide-react";
import { AddInventoryModal } from "@/components/AddInventoryModal";

interface InventoryItem {
  id: number;
  itemName: string;
  currentStock: string;
  minStock: string;
  unit: string;
  lastRestocked: string;
}

export default function Inventory() {
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const { data: inventory = [], isLoading } = useQuery<InventoryItem[]>({
    queryKey: ['/api/inventory'],
  });

  const { data: lowStockItems = [] } = useQuery<InventoryItem[]>({
    queryKey: ['/api/inventory/low-stock'],
  });

  const getStockLevel = (current: number, min: number) => {
    const percentage = (current / (min * 2)) * 100;
    return Math.min(100, Math.max(0, percentage));
  };

  const getStockStatus = (current: number, min: number) => {
    if (current <= min) return 'low';
    if (current <= min * 1.5) return 'medium';
    return 'high';
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'low': return 'bg-red-500';
      case 'medium': return 'bg-yellow-500';
      case 'high': return 'bg-emerald-500';
      default: return 'bg-gray-500';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'low': return 'Low Stock';
      case 'medium': return 'Medium Stock';
      case 'high': return 'Good Stock';
      default: return 'Unknown';
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'low': return 'bg-red-100/80 text-red-700';
      case 'medium': return 'bg-yellow-100/80 text-yellow-700';
      case 'high': return 'bg-emerald-100/80 text-emerald-700';
      default: return 'bg-gray-100/80 text-gray-700';
    }
  };

  const handleAddItem = () => { setEditingItem(null); setShowAddModal(true); };
  const handleEditItem = (item: InventoryItem) => { setEditingItem(item); setShowAddModal(true); };
  const handleCloseModal = () => { setShowAddModal(false); setEditingItem(null); };

  if (isLoading) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden bg-gradient-to-br from-slate-50 via-white to-emerald-50/30">
        <Header title="Inventory" description="Loading inventory..." />
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
      <Header title="Inventory" description="Track stock levels and manage inventory items" />

      <main className="min-h-0 flex-1 overflow-y-auto p-6">
        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-6">
          {[
            { label: "Total Items", value: inventory.length, icon: <Package className="w-6 h-6 text-blue-500" />, color: "text-blue-600" },
            { label: "Low Stock Items", value: lowStockItems.length, icon: <AlertTriangle className="w-6 h-6 text-red-500" />, color: "text-red-600" },
            { label: "Actions Required", value: lowStockItems.length, icon: <AlertTriangle className="w-6 h-6 text-orange-500" />, color: "text-orange-600" },
          ].map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05, duration: 0.2 }}
              className="rounded-2xl backdrop-blur-lg bg-white/40 border border-white/30 shadow-md p-5 flex items-center justify-between"
            >
              <div>
                <p className="text-sm text-gray-500">{stat.label}</p>
                <p className={`text-2xl font-bold mt-0.5 ${stat.color}`}>{stat.value}</p>
              </div>
              {stat.icon}
            </motion.div>
          ))}
        </div>

        {/* Low Stock Alert */}
        {lowStockItems.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 rounded-2xl backdrop-blur-lg bg-red-50/60 border border-red-200/60 shadow-md p-4"
          >
            <h3 className="text-red-800 font-semibold flex items-center gap-2 mb-3">
              <AlertTriangle className="w-4 h-4" /> Low Stock Alert
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {lowStockItems.map((item) => (
                <div key={item.id} className="flex items-center justify-between p-3 bg-white/60 backdrop-blur-sm rounded-xl border border-white/40">
                  <div>
                    <h4 className="font-medium text-sm">{item.itemName}</h4>
                    <p className="text-xs text-gray-500">{item.currentStock} {item.unit} remaining</p>
                  </div>
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    className="text-xs font-medium px-3 py-1.5 rounded-lg bg-white/70 border border-white/50 text-gray-600 hover:bg-white/90 transition-all"
                  >
                    Restock
                  </motion.button>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* Toolbar */}
        <div className="mb-5 flex justify-between items-center">
          <div>
            <h2 className="text-xl font-semibold text-gray-800">All Inventory Items</h2>
            <p className="text-sm text-gray-500">{inventory.length} items tracked</p>
          </div>
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

        {/* Inventory Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {inventory.map((item, i) => {
            const current = parseFloat(item.currentStock);
            const min = parseFloat(item.minStock);
            const status = getStockStatus(current, min);
            const stockLevel = getStockLevel(current, min);
            return (
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
                  <h3 className="font-semibold text-gray-800">{item.itemName}</h3>
                  <motion.button
                    whileTap={{ scale: 0.9 }}
                    onClick={() => handleEditItem(item)}
                    className="w-7 h-7 flex items-center justify-center rounded-xl bg-white/60 border border-white/40 text-gray-500 hover:text-emerald-600 hover:bg-white/80 transition-all"
                  >
                    <Edit className="w-3 h-3" />
                  </motion.button>
                </div>

                <div className="space-y-2.5">
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-gray-500">Current Stock</span>
                    <span className="text-sm font-semibold text-gray-700">{current} {item.unit}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-gray-500">Min Stock</span>
                    <span className="text-sm font-medium text-gray-600">{min} {item.unit}</span>
                  </div>
                  <div>
                    <div className="flex justify-between items-center mb-1.5">
                      <span className="text-xs text-gray-500">Stock Level</span>
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-lg ${getStatusBadge(status)}`}>
                        {getStatusText(status)}
                      </span>
                    </div>
                    {/* Glass progress bar */}
                    <div className="h-1.5 bg-white/40 rounded-full overflow-hidden border border-white/30">
                      <div
                        className={`h-full rounded-full transition-all ${getStatusColor(status)}`}
                        style={{ width: `${stockLevel}%` }}
                      />
                    </div>
                  </div>
                  <p className="text-xs text-gray-400 border-t border-white/40 pt-2">
                    Last restocked: {new Date(item.lastRestocked).toLocaleDateString()}
                  </p>
                </div>
              </motion.div>
            );
          })}
        </div>

        {inventory.length === 0 && (
          <div className="text-center py-16 rounded-2xl bg-white/30 backdrop-blur-sm border border-white/30 mt-4">
            <Package className="w-10 h-10 mx-auto mb-3 text-gray-300" />
            <h3 className="text-base font-semibold text-gray-600 mb-1">No inventory items yet</h3>
            <p className="text-sm text-gray-400 mb-4">Start tracking by adding your first item</p>
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={handleAddItem}
              className="px-4 py-2 rounded-xl text-sm font-semibold bg-gradient-to-r from-emerald-500 to-green-500 text-white shadow-sm hover:shadow-md transition-all"
            >
              <Plus className="w-4 h-4 inline mr-1" /> Add First Item
            </motion.button>
          </div>
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
