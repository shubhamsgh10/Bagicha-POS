import { useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useEffect } from "react";

const UNCATEGORIZED = "uncategorized";

const inventorySchema = z.object({
  itemName: z.string().min(1, "Item name is required"),
  categoryId: z.string().optional(),
  currentStock: z.string().min(1, "Current stock is required"),
  minStock: z.string().min(1, "Minimum stock is required"),
  unit: z.string().min(1, "Unit is required"),
  costPerUnit: z.string().optional(),
});

type InventoryForm = z.infer<typeof inventorySchema>;

interface InventoryCategoryOption {
  id: number;
  name: string;
}

interface AddInventoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  editItem?: any;
}

function emptyValues(): InventoryForm {
  return {
    itemName: "",
    categoryId: UNCATEGORIZED,
    currentStock: "",
    minStock: "",
    unit: "",
    costPerUnit: "",
  };
}

function valuesFromItem(item: any): InventoryForm {
  return {
    itemName: item.itemName ?? "",
    categoryId: item.categoryId != null ? String(item.categoryId) : UNCATEGORIZED,
    currentStock: item.currentStock ?? "",
    minStock: item.minStock ?? "",
    unit: item.unit ?? "",
    costPerUnit: item.costPerUnit ?? "",
  };
}

export function AddInventoryModal({ isOpen, onClose, editItem }: AddInventoryModalProps) {
  const { toast } = useToast();

  const { data: categories = [] } = useQuery<InventoryCategoryOption[]>({
    queryKey: ["/api/inventory-categories"],
    enabled: isOpen,
  });

  const form = useForm<InventoryForm>({
    resolver: zodResolver(inventorySchema),
    defaultValues: editItem ? valuesFromItem(editItem) : emptyValues(),
  });

  useEffect(() => {
    if (isOpen) {
      form.reset(editItem ? valuesFromItem(editItem) : emptyValues());
    }
  }, [isOpen, editItem, form]);

  const saveInventoryMutation = useMutation({
    mutationFn: async (data: InventoryForm) => {
      const url = editItem ? `/api/inventory/${editItem.id}` : '/api/inventory';
      const method = editItem ? 'PUT' : 'POST';
      const payload = {
        itemName: data.itemName,
        unit: data.unit,
        currentStock: data.currentStock,
        minStock: data.minStock,
        categoryId: data.categoryId && data.categoryId !== UNCATEGORIZED ? Number(data.categoryId) : null,
        costPerUnit: data.costPerUnit?.trim() ? data.costPerUnit : null,
      };
      const res = await apiRequest(method, url, payload);
      return await res.json();
    },
    onSuccess: () => {
      toast({
        title: editItem ? "Inventory Updated" : "Inventory Item Added",
        description: `Inventory item has been ${editItem ? 'updated' : 'added'} successfully`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/inventory'] });
      queryClient.invalidateQueries({ queryKey: ['/api/inventory/low-stock'] });
      queryClient.invalidateQueries({ queryKey: ['/api/inventory/negative-stock'] });
      onClose();
      form.reset();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || `Failed to ${editItem ? 'update' : 'add'} inventory item`,
        variant: "destructive",
      });
    },
  });

  const deleteInventoryMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest('DELETE', `/api/inventory/${id}`);
      return await res.json();
    },
    onSuccess: () => {
      toast({
        title: "Inventory Item Deleted",
        description: "Inventory item has been deleted successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/inventory'] });
      queryClient.invalidateQueries({ queryKey: ['/api/inventory/low-stock'] });
      queryClient.invalidateQueries({ queryKey: ['/api/inventory/negative-stock'] });
      onClose();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete inventory item",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: InventoryForm) => {
    saveInventoryMutation.mutate(data);
  };

  const handleDelete = () => {
    if (editItem && confirm("Are you sure you want to delete this inventory item?")) {
      deleteInventoryMutation.mutate(editItem.id);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {editItem ? "Edit Inventory Item" : "Add New Inventory Item"}
          </DialogTitle>
          <DialogDescription>
            {editItem ? "Update the inventory item details" : "Add a new item to your inventory"}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <Label htmlFor="itemName">Item Name *</Label>
              <Input
                id="itemName"
                placeholder="Enter item name"
                {...form.register("itemName")}
              />
              {form.formState.errors.itemName && (
                <p className="text-sm text-red-500">{form.formState.errors.itemName.message}</p>
              )}
            </div>
            <div>
              <Label htmlFor="categoryId">Category</Label>
              <Select
                value={form.watch("categoryId") || UNCATEGORIZED}
                onValueChange={(value: string) => form.setValue("categoryId", value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Uncategorized" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNCATEGORIZED}>Uncategorized</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="unit">Unit *</Label>
              <Select
                value={form.watch("unit")}
                onValueChange={(value: string) => form.setValue("unit", value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select unit" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="kg">Kilograms (kg)</SelectItem>
                  <SelectItem value="grams">Grams (g)</SelectItem>
                  <SelectItem value="liters">Liters (L)</SelectItem>
                  <SelectItem value="ml">Milliliters (ml)</SelectItem>
                  <SelectItem value="pieces">Pieces (pcs)</SelectItem>
                  <SelectItem value="packs">Packs</SelectItem>
                  <SelectItem value="bottles">Bottles</SelectItem>
                  <SelectItem value="cans">Cans</SelectItem>
                </SelectContent>
              </Select>
              {form.formState.errors.unit && (
                <p className="text-sm text-red-500">{form.formState.errors.unit.message}</p>
              )}
            </div>
            <div>
              <Label htmlFor="currentStock">Current Stock *</Label>
              <Input
                id="currentStock"
                type="number"
                step="0.01"
                placeholder="Enter current stock"
                {...form.register("currentStock")}
              />
              {form.formState.errors.currentStock && (
                <p className="text-sm text-red-500">{form.formState.errors.currentStock.message}</p>
              )}
            </div>
            <div>
              <Label htmlFor="minStock">Minimum Stock *</Label>
              <Input
                id="minStock"
                type="number"
                step="0.01"
                placeholder="Enter minimum stock level"
                {...form.register("minStock")}
              />
              {form.formState.errors.minStock && (
                <p className="text-sm text-red-500">{form.formState.errors.minStock.message}</p>
              )}
            </div>
            <div>
              <Label htmlFor="costPerUnit">Cost per Unit (₹) — optional</Label>
              <Input
                id="costPerUnit"
                type="number"
                step="0.01"
                placeholder="Enter cost per unit"
                {...form.register("costPerUnit")}
              />
            </div>
          </div>
          <div className="flex justify-between">
            <div className="flex space-x-2">
              <Button type="button" onClick={onClose}>
                Cancel
              </Button>
              {editItem && (
                <Button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleteInventoryMutation.isPending}
                >
                  {deleteInventoryMutation.isPending ? "Deleting..." : "Delete"}
                </Button>
              )}
            </div>
            <Button
              type="submit"
              disabled={saveInventoryMutation.isPending}
            >
              {saveInventoryMutation.isPending
                ? editItem
                  ? "Updating..."
                  : "Adding..."
                : editItem
                ? "Update Item"
                : "Add Item"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
