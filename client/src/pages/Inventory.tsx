import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Header } from "@/components/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
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
      case 'low':
        return 'bg-red-500';
      case 'medium':
        return 'bg-yellow-500';
      case 'high':
        return 'bg-green-500';
      default:
        return 'bg-gray-500';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'low':
        return 'Low Stock';
      case 'medium':
        return 'Medium Stock';
      case 'high':
        return 'Good Stock';
      default:
        return 'Unknown';
    }
  };

  const handleAddItem = () => {
    setEditingItem(null);
    setShowAddModal(true);
  };

  const handleEditItem = (item: InventoryItem) => {
    setEditingItem(item);
    setShowAddModal(true);
  };

  const handleCloseModal = () => {
    setShowAddModal(false);
    setEditingItem(null);
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header title="Inventory" description="Loading inventory..." />
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[...Array(6)].map((_, i) => (
              <Card key={i} className="animate-pulse">
                <CardContent className="p-4">
                  <div className="h-4 bg-muted rounded w-3/4 mb-2"></div>
                  <div className="h-3 bg-muted rounded w-1/2 mb-3"></div>
                  <div className="h-2 bg-muted rounded w-full"></div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <Header
        title="Inventory"
        description="Track stock levels and manage inventory items"
      />
      <main className="min-h-0 flex-1 overflow-y-auto custom-scrollbar p-6">
        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Total Items</p>
                  <p className="text-2xl font-bold">{inventory.length}</p>
                </div>
                <Package className="w-8 h-8 text-blue-500" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Low Stock Items</p>
                  <p className="text-2xl font-bold text-red-500">{lowStockItems.length}</p>
                </div>
                <AlertTriangle className="w-8 h-8 text-red-500" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Actions Required</p>
                  <p className="text-2xl font-bold text-orange-500">{lowStockItems.length}</p>
                </div>
                <AlertTriangle className="w-8 h-8 text-orange-500" />
              </div>
            </CardContent>
          </Card>
        </div>
        {/* Low Stock Alert */}
        {lowStockItems.length > 0 && (
          <Card className="mb-6 border-red-200 bg-red-50">
            <CardHeader>
              <CardTitle className="text-red-800 flex items-center">
                <AlertTriangle className="w-5 h-5 mr-2" />
                Low Stock Alert
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {lowStockItems.map((item) => (
                  <div key={item.id} className="flex items-center justify-between p-3 bg-white rounded-lg border">
                    <div>
                      <h4 className="font-medium">{item.itemName}</h4>
                      <p className="text-sm text-muted-foreground">
                        {item.currentStock} {item.unit} remaining
                      </p>
                    </div>
                    <Button size="sm" variant="outline">
                      Restock
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
        {/* Inventory Items */}
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-semibold">All Inventory Items</h2>
          <Button onClick={handleAddItem}>
            <Plus className="w-4 h-4 mr-2" />
            Add Item
          </Button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {inventory.map((item) => {
            const current = parseFloat(item.currentStock);
            const min = parseFloat(item.minStock);
            const status = getStockStatus(current, min);
            const stockLevel = getStockLevel(current, min);
            return (
              <Card key={item.id} className="bg-card shadow-sm">
                <CardContent className="p-4">
                  <div className="flex justify-between items-start mb-3">
                    <h3 className="font-medium text-foreground">{item.itemName}</h3>
                    <Button size="sm" variant="outline" onClick={() => handleEditItem(item)}>
                      <Edit className="w-3 h-3" />
                    </Button>
                  </div>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Current Stock</span>
                      <span className="font-medium">{current} {item.unit}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Min Stock</span>
                      <span className="font-medium">{min} {item.unit}</span>
                    </div>
                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-sm text-muted-foreground">Stock Level</span>
                        <Badge className={`${getStatusColor(status)} text-white text-xs`}>
                          {getStatusText(status)}
                        </Badge>
                      </div>
                      <Progress value={stockLevel} className="h-2" />
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Last restocked: {new Date(item.lastRestocked).toLocaleDateString()}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
        {inventory.length === 0 && (
          <Card className="text-center py-12">
            <CardContent>
              <Package className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No inventory items found</h3>
              <p className="text-muted-foreground mb-4">
                Start tracking your inventory by adding items
              </p>
              <Button onClick={handleAddItem}>
                <Plus className="w-4 h-4 mr-2" />
                Add First Item
              </Button>
            </CardContent>
          </Card>
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
