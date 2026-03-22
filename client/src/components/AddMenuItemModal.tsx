import { useQuery, useMutation } from "@tanstack/react-query";
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
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useEffect, useState } from "react";

const PIZZA_SIZES = ["Small", "Medium", "Large"] as const;
const WOODFIRE_PIZZA = "Woodfire Pizza";

const menuItemSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  price: z.string().default("0"),
  categoryId: z.number().min(1, "Category is required"),
  preparationTime: z.number().min(1, "Preparation time is required"),
  isAvailable: z.boolean().default(true),
  isVegetarian: z.boolean().default(false),
  isSpicy: z.boolean().default(false),
  allergens: z.string().optional(),
});

type MenuItemForm = z.infer<typeof menuItemSchema>;

interface AddMenuItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  editItem?: any;
}

export function AddMenuItemModal({ isOpen, onClose, editItem }: AddMenuItemModalProps) {
  const { toast } = useToast();
  const [sizePrices, setSizePrices] = useState<Record<string, string>>({
    Small: "",
    Medium: "",
    Large: "",
  });

  const form = useForm<MenuItemForm>({
    resolver: zodResolver(menuItemSchema),
    defaultValues: {
      name: editItem?.name || "",
      description: editItem?.description || "",
      price: editItem?.price || "0",
      categoryId: editItem?.categoryId || 0,
      preparationTime: editItem?.preparationTime || 15,
      isAvailable: editItem?.isAvailable ?? true,
      isVegetarian: editItem?.isVegetarian ?? false,
      isSpicy: editItem?.isSpicy ?? false,
      allergens: editItem?.allergens || "",
    },
  });

  const { data: categories } = useQuery<any[]>({
    queryKey: ['/api/categories'],
  });

  const selectedCategoryId = form.watch("categoryId");
  const selectedCategory = categories?.find((c: any) => c.id === selectedCategoryId);
  const isWoodfirePizza = selectedCategory?.name === WOODFIRE_PIZZA;

  const createMenuItemMutation = useMutation({
    mutationFn: async (data: any) => {
      const url = editItem ? `/api/menu/${editItem.id}` : '/api/menu';
      const method = editItem ? 'PUT' : 'POST';
      return await apiRequest(method, url, data);
    },
    onSuccess: () => {
      toast({
        title: editItem ? "Menu Item Updated" : "Menu Item Created",
        description: `Menu item has been ${editItem ? 'updated' : 'created'} successfully`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/menu'] });
      onClose();
      form.reset();
      setSizePrices({ Small: "", Medium: "", Large: "" });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || `Failed to ${editItem ? 'update' : 'create'} menu item`,
        variant: "destructive",
      });
    },
  });

  const deleteMenuItemMutation = useMutation({
    mutationFn: async (id: number) => {
      return await apiRequest('DELETE', `/api/menu/${id}`);
    },
    onSuccess: () => {
      toast({
        title: "Menu Item Deleted",
        description: "Menu item has been deleted successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/menu'] });
      onClose();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete menu item",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: MenuItemForm) => {
    if (isWoodfirePizza) {
      const missingPrices = PIZZA_SIZES.filter(s => !sizePrices[s] || isNaN(parseFloat(sizePrices[s])));
      if (missingPrices.length > 0) {
        toast({
          title: "Missing Prices",
          description: `Please enter prices for: ${missingPrices.join(", ")}`,
          variant: "destructive",
        });
        return;
      }

      const sizes = PIZZA_SIZES.map(s => ({ size: s, price: parseFloat(sizePrices[s]) }));
      const minPrice = Math.min(...sizes.map(s => s.price));

      createMenuItemMutation.mutate({
        ...data,
        price: minPrice.toString(),
        sizes,
      });
    } else {
      if (!data.price || isNaN(parseFloat(data.price)) || parseFloat(data.price) < 0) {
        toast({ title: "Invalid price", description: "Please enter a valid price", variant: "destructive" });
        return;
      }
      createMenuItemMutation.mutate({ ...data, sizes: null });
    }
  };

  const handleDelete = () => {
    if (editItem && confirm("Are you sure you want to delete this menu item?")) {
      deleteMenuItemMutation.mutate(editItem.id);
    }
  };

  useEffect(() => {
    if (editItem) {
      form.reset({
        name: editItem.name || "",
        description: editItem.description || "",
        price: editItem.price || "0",
        categoryId: editItem.categoryId || 0,
        preparationTime: editItem.preparationTime || 15,
        isAvailable: editItem.isAvailable ?? true,
        isVegetarian: editItem.isVegetarian ?? false,
        isSpicy: editItem.isSpicy ?? false,
        allergens: editItem.allergens || "",
      });

      if (editItem.sizes && editItem.sizes.length > 0) {
        const sp: Record<string, string> = { Small: "", Medium: "", Large: "" };
        editItem.sizes.forEach((s: any) => {
          if (s.size in sp) sp[s.size] = s.price.toString();
        });
        setSizePrices(sp);
      } else {
        setSizePrices({ Small: "", Medium: "", Large: "" });
      }
    } else {
      form.reset({
        name: "",
        description: "",
        price: "0",
        categoryId: 0,
        preparationTime: 15,
        isAvailable: true,
        isVegetarian: false,
        isSpicy: false,
        allergens: "",
      });
      setSizePrices({ Small: "", Medium: "", Large: "" });
    }
  }, [editItem]);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {editItem ? "Edit Menu Item" : "Add New Menu Item"}
          </DialogTitle>
          <DialogDescription>
            {editItem ? "Update the menu item details" : "Create a new menu item for your restaurant"}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="name">Item Name *</Label>
              <Input
                id="name"
                placeholder="Enter item name"
                {...form.register("name")}
              />
              {form.formState.errors.name && (
                <p className="text-sm text-red-500">{form.formState.errors.name.message}</p>
              )}
            </div>

            {isWoodfirePizza ? (
              <div className="md:col-span-1">
                <Label className="text-sm font-medium">Size Pricing *</Label>
                <div className="space-y-2 mt-1">
                  {PIZZA_SIZES.map((size) => (
                    <div key={size} className="flex items-center gap-3">
                      <span className="w-16 text-sm text-muted-foreground">{size}</span>
                      <div className="flex items-center flex-1 gap-1">
                        <span className="text-sm text-muted-foreground">₹</span>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="0"
                          value={sizePrices[size]}
                          onChange={(e) =>
                            setSizePrices((prev) => ({ ...prev, [size]: e.target.value }))
                          }
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div>
                <Label htmlFor="price">Price (₹) *</Label>
                <Input
                  id="price"
                  type="number"
                  step="0.01"
                  placeholder="Enter price"
                  {...form.register("price")}
                />
                {form.formState.errors.price && (
                  <p className="text-sm text-red-500">{form.formState.errors.price.message}</p>
                )}
              </div>
            )}

            <div>
              <Label htmlFor="category">Category *</Label>
              <Select
                value={form.watch("categoryId")?.toString()}
                onValueChange={(value) => form.setValue("categoryId", parseInt(value))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {categories?.map((category: any) => (
                    <SelectItem key={category.id} value={category.id.toString()}>
                      {category.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.formState.errors.categoryId && (
                <p className="text-sm text-red-500">{form.formState.errors.categoryId.message}</p>
              )}
            </div>

            <div>
              <Label htmlFor="preparationTime">Preparation Time (minutes) *</Label>
              <Input
                id="preparationTime"
                type="number"
                placeholder="Enter preparation time"
                {...form.register("preparationTime", { valueAsNumber: true })}
              />
              {form.formState.errors.preparationTime && (
                <p className="text-sm text-red-500">{form.formState.errors.preparationTime.message}</p>
              )}
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

          <div>
            <Label htmlFor="allergens">Allergens</Label>
            <Input
              id="allergens"
              placeholder="e.g., Nuts, Dairy, Gluten"
              {...form.register("allergens")}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="flex items-center space-x-2">
              <Switch
                id="isAvailable"
                checked={form.watch("isAvailable")}
                onCheckedChange={(checked) => form.setValue("isAvailable", checked)}
              />
              <Label htmlFor="isAvailable">Available</Label>
            </div>

            <div className="flex items-center space-x-2">
              <Switch
                id="isVegetarian"
                checked={form.watch("isVegetarian")}
                onCheckedChange={(checked) => form.setValue("isVegetarian", checked)}
              />
              <Label htmlFor="isVegetarian">Vegetarian</Label>
            </div>

            <div className="flex items-center space-x-2">
              <Switch
                id="isSpicy"
                checked={form.watch("isSpicy")}
                onCheckedChange={(checked) => form.setValue("isSpicy", checked)}
              />
              <Label htmlFor="isSpicy">Spicy</Label>
            </div>
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
                  disabled={deleteMenuItemMutation.isPending}
                >
                  {deleteMenuItemMutation.isPending ? "Deleting..." : "Delete"}
                </Button>
              )}
            </div>
            <Button
              type="submit"
              disabled={createMenuItemMutation.isPending}
            >
              {createMenuItemMutation.isPending ?
                (editItem ? "Updating..." : "Creating...") :
                (editItem ? "Update Item" : "Create Item")
              }
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
