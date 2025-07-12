import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogDescription 
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

const inventorySchema = z.object({
  itemName: z.string().min(1, "Item name is required"),
  description: z.string().optional(),
  currentStock: z.string().min(1, "Current stock is required"),
  minStock: z.string().min(1, "Minimum stock is required"),
  unit: z.string().min(1, "Unit is required"),
  supplierName: z.string().optional(),
  supplierContact: z.string().optional(),
  costPerUnit: z.string().optional(),
  expiryDate: z.string().optional(),
});

type InventoryForm = z.infer<typeof inventorySchema>;

interface AddInventoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  editItem?: any;
}

export function AddInventoryModal({ isOpen, onClose, editItem }: AddInventoryModalProps) {
  const { toast } = useToast();

  const form = useForm<InventoryForm>({
    resolver: zodResolver(inventorySchema),
    defaultValues: {
      itemName: editItem?.itemName || "",
      description: editItem?.description || "",
      currentStock: editItem?.currentStock || "",
      minStock: editItem?.minStock || "",
      unit: editItem?.unit || "",
      supplierName: editItem?.supplierName || "",
      supplierContact: editItem?.supplierContact || "",
      costPerUnit: editItem?.costPerUnit || "",
      expiryDate: editItem?.expiryDate || "",
    },
  });

  const createInventoryMutation = useMutation({
    mutationFn: async (data: InventoryForm) => {
      const url = editItem ? `/api/inventory/${editItem.id}` : '/api/inventory';
      const method = editItem ? 'PUT' : 'POST';
      return await apiRequest({ url, method, data });
    },
    onSuccess: () => {
      toast({
        title: editItem ? "Inventory Updated" : "Inventory Item Added",
        description: `Inventory item has been ${editItem ? 'updated' : 'added'} successfully`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/inventory'] });
      queryClient.invalidateQueries({ queryKey: ['/api/inventory/low-stock'] });
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
      return await apiRequest({ url: `/api/inventory/${id}`, method: 'DELETE' });
    },
    onSuccess: () => {
      toast({
        title: "Inventory Item Deleted",
        description: "Inventory item has been deleted successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/inventory'] });
      queryClient.invalidateQueries({ queryKey: ['/api/inventory/low-stock'] });
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
    createInventoryMutation.mutate(data);
  };

  const handleDelete = () => {
    if (editItem && confirm("Are you sure you want to delete this inventory item?")) {
      deleteInventoryMutation.mutate(editItem.id);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
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
            <div>
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
              <Label htmlFor="unit">Unit *</Label>
              <Select 
                value={form.watch("unit")} 
                onValueChange={(value) => form.setValue("unit", value)}
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
              <Label htmlFor="costPerUnit">Cost per Unit (₹)</Label>
              <Input
                id="costPerUnit"
                type="number"
                step="0.01"
                placeholder="Enter cost per unit"
                {...form.register("costPerUnit")}
              />
            </div>

            <div>
              <Label htmlFor="expiryDate">Expiry Date</Label>
              <Input
                id="expiryDate"
                type="date"
                {...form.register("expiryDate")}
              />
            </div>

            <div>
              <Label htmlFor="supplierName">Supplier Name</Label>
              <Input
                id="supplierName"
                placeholder="Enter supplier name"
                {...form.register("supplierName")}
              />
            </div>

            <div>
              <Label htmlFor="supplierContact">Supplier Contact</Label>
              <Input
                id="supplierContact"
                placeholder="Enter supplier contact"
                {...form.register("supplierContact")}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              placeholder="Enter item description"
              {...form.register("description")}
            />
          </div>

          <div className="flex justify-between">
            <div className="flex space-x-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              {editItem && (
                <Button 
                  type="button" 
                  variant="destructive" 
                  onClick={handleDelete}
                  disabled={deleteInventoryMutation.isPending}
                >
                  {deleteInventoryMutation.isPending ? "Deleting..." : "Delete"}
                </Button>
              )}
            </div>
            <Button 
              type="submit" 
              disabled={createInventoryMutation.isPending}
            >
              {createInventoryMutation.isPending ? 
                (editItem ? "Updating..." : "Adding...") : 
                (editItem ? "Update Item" : "Add Item")
              }
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}