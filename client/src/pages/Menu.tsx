import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Header } from "@/components/Header";
import { MenuItemCard } from "@/components/ui/menu-item-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Edit, Trash2 } from "lucide-react";
import { AddMenuItemModal } from "@/components/AddMenuItemModal";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface Category {
  id: number;
  name: string;
  description?: string;
}

interface MenuItem {
  id: number;
  name: string;
  description?: string;
  price: string;
  categoryId: number;
  preparationTime: number;
  isAvailable: boolean;
  isVegetarian?: boolean;
  isSpicy?: boolean;
  allergens?: string;
  sizes?: Array<{ size: string; price: number }>;
}

export default function Menu() {
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const { data: menuItems = [], isLoading } = useQuery<MenuItem[]>({
    queryKey: ['/api/menu'],
  });

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ['/api/categories'],
  });

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 0
    }).format(amount);
  };

  const getCategoryName = (categoryId: number) => {
    const category = categories.find((cat) => cat.id === categoryId);
    return category?.name || 'Unknown Category';
  };

  const handleAddItem = () => {
    setEditingItem(null);
    setShowAddModal(true);
  };

  const handleEditItem = (item: MenuItem) => {
    setEditingItem(item);
    setShowAddModal(true);
  };

  const handleCloseModal = () => {
    setShowAddModal(false);
    setEditingItem(null);
  };

  const deleteMenuItemMutation = useMutation({
    mutationFn: async (id: number) => {
      return await apiRequest('DELETE', `/api/menu/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/menu'] });
    },
  });

  const handleDeleteItem = (item: MenuItem) => {
    if (window.confirm(`Are you sure you want to delete "${item.name}"?`)) {
      deleteMenuItemMutation.mutate(item.id);
    }
  };

  if (isLoading) {
    return (
      <div className="flex-1 overflow-hidden">
        <Header title="Menu" description="Loading menu items..." />
        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[...Array(6)].map((_, i) => (
              <Card key={i} className="animate-pulse">
                <CardContent className="p-4">
                  <div className="h-32 bg-muted rounded-lg mb-3"></div>
                  <div className="h-4 bg-muted rounded w-3/4 mb-2"></div>
                  <div className="h-3 bg-muted rounded w-1/2"></div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1">
      <Header
        title="Menu"
        description="Manage your restaurant menu items and categories"
      />

      <main className="flex-1 overflow-y-auto p-6">
        <div className="mb-6 flex justify-between items-center">
          <div>
            <h2 className="text-xl font-semibold">Menu Items</h2>
            <p className="text-muted-foreground">
              {menuItems.length} items available
            </p>
          </div>
          <Button onClick={handleAddItem} variant="default">
            <Plus className="w-4 h-4 mr-2" />
            Add Menu Item
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {menuItems.map((item) => (
            <Card key={item.id} className="bg-card shadow-sm">
              <CardContent className="p-4">
                <div className="flex justify-between items-start mb-3">
                  <Badge variant="secondary" className="text-xs">
                    {getCategoryName(item.categoryId)}
                  </Badge>
                  <div className="flex space-x-2">
                    <Button size="sm" variant="outline" onClick={() => handleEditItem(item)}>
                      <Edit className="w-3 h-3" />
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => handleDeleteItem(item)} disabled={deleteMenuItemMutation.isPending}>
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>

                <h3 className="font-medium text-foreground mb-2">{item.name}</h3>
                <p className="text-sm text-muted-foreground mb-2">{item.description}</p>
                <div className="flex justify-between items-center">
                  {item.sizes && item.sizes.length > 0 ? (
                    <div className="flex flex-wrap gap-x-2 gap-y-1 text-sm text-foreground">
                      {item.sizes.map((s) => (
                        <span key={s.size}>
                          <span className="text-muted-foreground">{s.size}</span>{" "}
                          <span className="font-semibold">{formatCurrency(s.price)}</span>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-lg font-semibold text-foreground">
                      {formatCurrency(parseFloat(item.price))}
                    </span>
                  )}
                  <Badge variant={item.isAvailable ? "default" : "destructive"}>
                    {item.isAvailable ? "Available" : "Out of Stock"}
                  </Badge>
                </div>

                <div className="mt-3 flex justify-between items-center text-sm text-muted-foreground">
                  <span>Prep time: {item.preparationTime}min</span>
                  <span>Sold: {Math.floor(Math.random() * 50)} today</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {menuItems.length === 0 && (
          <Card className="text-center py-12">
            <CardContent>
              <h3 className="text-lg font-semibold mb-2">No menu items found</h3>
              <p className="text-muted-foreground mb-4">
                Get started by adding your first menu item
              </p>
              <Button onClick={handleAddItem} variant="default">
                <Plus className="w-4 h-4 mr-2" />
                Add Menu Item
              </Button>
            </CardContent>
          </Card>
        )}
      </main>

      <AddMenuItemModal
        isOpen={showAddModal}
        onClose={handleCloseModal}
        editItem={editingItem || undefined}
      />
    </div>
  );
}
