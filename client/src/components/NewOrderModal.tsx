import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Minus, ShoppingCart, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

const orderSchema = z.object({
  customerName: z.string().optional(),
  customerPhone: z.string().optional(),
  orderType: z.enum(["dine-in", "takeaway", "delivery"]),
  tableNumber: z.string().optional(),
  paymentMethod: z.enum(["cash", "card", "upi", "online"]).optional(),
  notes: z.string().optional(),
});

type OrderForm = z.infer<typeof orderSchema>;

interface SizeOption {
  size: string;
  price: number;
}

interface AddonOption {
  name: string;
  price: number;
}

interface CartItem {
  cartKey: string;
  id: number;
  name: string;
  basePrice: number;
  addons: AddonOption[];
  totalPrice: number;
  quantity: number;
  specialInstructions?: string;
  size?: string;
}

interface NewOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function NewOrderModal({ isOpen, onClose }: NewOrderModalProps) {
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");

  // Combined picker state (size + addons)
  const [pickerItem, setPickerItem] = useState<any | null>(null);
  const [chosenSize, setChosenSize] = useState<SizeOption | null>(null);
  const [chosenAddons, setChosenAddons] = useState<AddonOption[]>([]);

  const { toast } = useToast();

  const form = useForm<OrderForm>({
    resolver: zodResolver(orderSchema),
    defaultValues: { orderType: "dine-in", paymentMethod: "cash" },
  });

  const { data: categories } = useQuery<any[]>({ queryKey: ["/api/categories"] });
  const { data: menuItems } = useQuery<any[]>({ queryKey: ["/api/menu"] });

  const createOrderMutation = useMutation({
    mutationFn: async (orderData: any) => {
      return await apiRequest("POST", "/api/orders", orderData);
    },
    onSuccess: () => {
      toast({ title: "Order Created", description: "New order has been created successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      onClose();
      form.reset();
      setCartItems([]);
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to create order", variant: "destructive" });
    },
  });

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 0 }).format(amount);

  // ── Picker helpers ───────────────────────────────────────────────────────────

  const openPicker = (item: any) => {
    setPickerItem(item);
    setChosenSize(null);
    setChosenAddons([]);
  };

  const closePicker = () => {
    setPickerItem(null);
    setChosenSize(null);
    setChosenAddons([]);
  };

  const toggleAddon = (addon: AddonOption) => {
    setChosenAddons(prev => {
      const exists = prev.some(a => a.name === addon.name);
      return exists ? prev.filter(a => a.name !== addon.name) : [...prev, addon];
    });
  };

  // Picker live total
  const pickerHasSizes = pickerItem && Array.isArray(pickerItem.sizes) && pickerItem.sizes.length > 0;
  const pickerBasePrice = pickerItem
    ? (pickerHasSizes && chosenSize ? Number(chosenSize.price) : parseFloat(pickerItem.price || "0"))
    : 0;
  const pickerAddonTotal = chosenAddons.reduce((s, a) => s + Number(a.price), 0);
  const pickerTotal = pickerBasePrice + pickerAddonTotal;

  const confirmAndAdd = () => {
    if (!pickerItem) return;
    if (pickerHasSizes && !chosenSize) return;

    const basePrice = pickerHasSizes ? Number(chosenSize!.price) : parseFloat(pickerItem.price || "0");
    const addonTotal = chosenAddons.reduce((s, a) => s + Number(a.price), 0);
    const totalPrice = basePrice + addonTotal;
    const size = chosenSize?.size;
    const sortedAddonNames = [...chosenAddons].map(a => a.name).sort().join(",");
    const cartKey = `${pickerItem.id}-${size || ""}-${sortedAddonNames}`;

    setCartItems(prev => {
      const existing = prev.find(c => c.cartKey === cartKey);
      if (existing) {
        return prev.map(c => c.cartKey === cartKey ? { ...c, quantity: c.quantity + 1 } : c);
      }
      return [...prev, {
        cartKey,
        id: pickerItem.id,
        name: pickerItem.name,
        basePrice,
        addons: chosenAddons,
        totalPrice,
        quantity: 1,
        size,
      }];
    });

    closePicker();
  };

  // ── Cart helpers ─────────────────────────────────────────────────────────────

  const directAddItem = (item: any) => {
    const basePrice = parseFloat(item.price || "0");
    const cartKey = `${item.id}`;
    setCartItems(prev => {
      const existing = prev.find(c => c.cartKey === cartKey);
      if (existing) {
        return prev.map(c => c.cartKey === cartKey ? { ...c, quantity: c.quantity + 1 } : c);
      }
      return [...prev, { cartKey, id: item.id, name: item.name, basePrice, addons: [], totalPrice: basePrice, quantity: 1 }];
    });
  };

  const removeFromCart = (cartKey: string) =>
    setCartItems(prev => prev.filter(c => c.cartKey !== cartKey));

  const updateQty = (cartKey: string, qty: number) => {
    if (qty <= 0) { removeFromCart(cartKey); return; }
    setCartItems(prev => prev.map(c => c.cartKey === cartKey ? { ...c, quantity: qty } : c));
  };

  const updateInstructions = (cartKey: string, instructions: string) =>
    setCartItems(prev => prev.map(c => c.cartKey === cartKey ? { ...c, specialInstructions: instructions } : c));

  // ── Totals ───────────────────────────────────────────────────────────────────

  const totals = (() => {
    const subtotal = cartItems.reduce((s, i) => s + i.totalPrice * i.quantity, 0);
    const tax = subtotal * 0.18;
    return { subtotal, tax, total: subtotal + tax };
  })();

  // ── Filter menu ──────────────────────────────────────────────────────────────

  const filteredItems = menuItems?.filter((item: any) =>
    selectedCategory === "all" || item.categoryId === parseInt(selectedCategory)
  );

  // ── Submit ───────────────────────────────────────────────────────────────────

  const onSubmit = (data: OrderForm) => {
    if (cartItems.length === 0) {
      toast({ title: "Error", description: "Please add at least one item to the order", variant: "destructive" });
      return;
    }
    createOrderMutation.mutate({
      ...data,
      totalAmount: totals.total.toFixed(2),
      taxAmount: totals.tax.toFixed(2),
      discountAmount: "0",
      items: cartItems.map((c) => ({
        menuItemId: c.id,
        quantity: c.quantity,
        price: c.totalPrice.toFixed(2),
        specialInstructions: c.specialInstructions || "",
        name: c.size ? `${c.name} (${c.size})` : c.name,
        size: c.size || null,
        addons: c.addons,
      })),
    });
  };

  // ── UI ───────────────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── Combined Size + Addon Picker ─────────────────────────────────────── */}
      <Dialog open={!!pickerItem} onOpenChange={closePicker}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{pickerItem?.name}</DialogTitle>
            <DialogDescription>Customize your order</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-1">
            {/* Size selection */}
            {pickerHasSizes && (
              <div>
                <p className="font-medium text-sm mb-2">Select Size</p>
                <div className="space-y-2">
                  {pickerItem.sizes.map((s: SizeOption) => {
                    const isChosen = chosenSize?.size === s.size;
                    return (
                      <label
                        key={s.size}
                        className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors ${
                          isChosen ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <input
                            type="radio"
                            name="picker-size"
                            checked={isChosen}
                            onChange={() => setChosenSize({ size: s.size, price: Number(s.price) })}
                            className="accent-primary w-4 h-4"
                          />
                          <span className="font-medium">{s.size}</span>
                        </div>
                        <span className="font-semibold text-primary">{formatCurrency(Number(s.price))}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Addon selection */}
            {pickerItem?.addonsEnabled && Array.isArray(pickerItem.addons) && pickerItem.addons.length > 0 && (
              <div>
                <p className="font-medium text-sm mb-2">Add Extras</p>
                <div className="space-y-2">
                  {pickerItem.addons.map((a: AddonOption) => {
                    const isChecked = chosenAddons.some(ca => ca.name === a.name);
                    return (
                      <label
                        key={a.name}
                        className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors ${
                          isChecked ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleAddon({ name: a.name, price: Number(a.price) })}
                            className="accent-primary w-4 h-4"
                          />
                          <span className="font-medium">{a.name}</span>
                        </div>
                        <span className="text-sm font-semibold text-primary">+{formatCurrency(Number(a.price))}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Live total */}
            <div className="border-t pt-3 flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Total</span>
              <span className="font-bold text-base">{formatCurrency(pickerTotal)}</span>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={closePicker}>Cancel</Button>
            <Button
              disabled={!!(pickerHasSizes && !chosenSize)}
              onClick={confirmAndAdd}
            >
              Add to Order
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Main New Order Dialog ─────────────────────────────────────────────── */}
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle>Create New Order</DialogTitle>
            <DialogDescription>Add items to the order and fill in customer details</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col h-full">
            <Tabs defaultValue="menu" className="flex-1">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="menu">Menu Items</TabsTrigger>
                <TabsTrigger value="details">Order Details</TabsTrigger>
              </TabsList>

              {/* ── Menu Tab ───────────────────────────────────────────────────── */}
              <TabsContent value="menu" className="flex-1">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-full">

                  {/* Left: item grid */}
                  <div className="lg:col-span-2">
                    <div className="mb-4">
                      <Label>Category</Label>
                      <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                        <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Categories</SelectItem>
                          {categories?.map((cat: any) => (
                            <SelectItem key={cat.id} value={cat.id.toString()}>{cat.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <ScrollArea className="h-[400px]">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {filteredItems?.map((item: any) => {
                          const hasSizes = Array.isArray(item.sizes) && item.sizes.length > 0;
                          const hasAddons = item.addonsEnabled && Array.isArray(item.addons) && item.addons.length > 0;
                          const needsPicker = hasSizes || hasAddons;

                          return (
                            <Card key={item.id} className="hover:shadow-md transition-shadow">
                              <CardContent className="p-4">
                                <div className="flex justify-between items-start mb-2">
                                  <h3 className="font-medium text-sm">{item.name}</h3>
                                  <Badge variant={item.isAvailable ? "default" : "destructive"} className="text-xs">
                                    {item.isAvailable ? "Available" : "Unavailable"}
                                  </Badge>
                                </div>

                                {item.description && (
                                  <p className="text-xs text-muted-foreground mb-2">{item.description}</p>
                                )}

                                {hasSizes ? (
                                  <>
                                    <div className="flex flex-wrap gap-x-3 gap-y-1 mb-3">
                                      {item.sizes.map((s: SizeOption) => (
                                        <span key={s.size} className="text-xs text-muted-foreground">
                                          {s.size}{" "}
                                          <span className="font-semibold text-foreground">
                                            {formatCurrency(Number(s.price))}
                                          </span>
                                        </span>
                                      ))}
                                    </div>
                                    <Button
                                      size="sm"
                                      className="w-full"
                                      disabled={!item.isAvailable}
                                      onClick={() => openPicker(item)}
                                    >
                                      Select Size & Add
                                    </Button>
                                  </>
                                ) : (
                                  <div className="flex justify-between items-center">
                                    <span className="font-semibold text-sm">
                                      {formatCurrency(parseFloat(item.price))}
                                    </span>
                                    {needsPicker ? (
                                      <Button
                                        size="sm"
                                        disabled={!item.isAvailable}
                                        onClick={() => openPicker(item)}
                                      >
                                        Customize
                                      </Button>
                                    ) : (
                                      <Button
                                        size="sm"
                                        disabled={!item.isAvailable}
                                        onClick={() => directAddItem(item)}
                                      >
                                        <Plus className="w-4 h-4 mr-1" />
                                        Add
                                      </Button>
                                    )}
                                  </div>
                                )}
                              </CardContent>
                            </Card>
                          );
                        })}
                      </div>
                    </ScrollArea>
                  </div>

                  {/* Right: cart */}
                  <div className="lg:col-span-1">
                    <Card>
                      <CardContent className="p-4">
                        <h3 className="font-medium mb-4 flex items-center gap-2">
                          <ShoppingCart className="w-4 h-4" />
                          Cart ({cartItems.length} items)
                        </h3>

                        <ScrollArea className="h-[300px] mb-4">
                          <div className="space-y-3">
                            {cartItems.length === 0 && (
                              <p className="text-sm text-muted-foreground text-center py-8">No items added yet</p>
                            )}
                            {cartItems.map((item) => (
                              <div key={item.cartKey} className="border rounded-lg p-3">
                                <div className="flex justify-between items-start mb-1">
                                  <div className="flex-1 min-w-0">
                                    <p className="font-medium text-sm">
                                      {item.name}{item.size ? ` (${item.size})` : ""}
                                    </p>
                                    {item.addons.map(a => (
                                      <p key={a.name} className="text-xs text-muted-foreground">
                                        + {a.name}
                                      </p>
                                    ))}
                                  </div>
                                  <Button size="sm" variant="ghost" onClick={() => removeFromCart(item.cartKey)}>
                                    <Trash2 className="w-3 h-3" />
                                  </Button>
                                </div>

                                <div className="flex items-center justify-between mb-2">
                                  <div className="flex items-center gap-2">
                                    <Button size="sm" variant="outline" onClick={() => updateQty(item.cartKey, item.quantity - 1)}>
                                      <Minus className="w-3 h-3" />
                                    </Button>
                                    <span className="w-8 text-center text-sm">{item.quantity}</span>
                                    <Button size="sm" variant="outline" onClick={() => updateQty(item.cartKey, item.quantity + 1)}>
                                      <Plus className="w-3 h-3" />
                                    </Button>
                                  </div>
                                  <span className="font-medium text-sm">
                                    {formatCurrency(item.totalPrice * item.quantity)}
                                  </span>
                                </div>

                                <Input
                                  placeholder="Special instructions..."
                                  value={item.specialInstructions || ""}
                                  onChange={(e) => updateInstructions(item.cartKey, e.target.value)}
                                  className="text-xs h-7"
                                />
                              </div>
                            ))}
                          </div>
                        </ScrollArea>

                        <Separator className="my-3" />

                        <div className="space-y-1 text-sm">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Subtotal</span>
                            <span>{formatCurrency(totals.subtotal)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">GST (18%)</span>
                            <span>{formatCurrency(totals.tax)}</span>
                          </div>
                          <div className="flex justify-between font-bold text-base pt-1">
                            <span>Total</span>
                            <span>{formatCurrency(totals.total)}</span>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </div>
              </TabsContent>

              {/* ── Order Details Tab ───────────────────────────────────────────── */}
              <TabsContent value="details" className="flex-1">
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-4">
                      <div>
                        <Label htmlFor="customerName">Customer Name</Label>
                        <Input id="customerName" placeholder="Enter customer name" {...form.register("customerName")} />
                      </div>
                      <div>
                        <Label htmlFor="customerPhone">Customer Phone</Label>
                        <Input id="customerPhone" placeholder="Enter phone number" {...form.register("customerPhone")} />
                      </div>
                      <div>
                        <Label>Order Type</Label>
                        <Select value={form.watch("orderType")} onValueChange={(v) => form.setValue("orderType", v as any)}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="dine-in">Dine In</SelectItem>
                            <SelectItem value="takeaway">Takeaway</SelectItem>
                            <SelectItem value="delivery">Delivery</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div>
                        <Label htmlFor="tableNumber">Table Number</Label>
                        <Input id="tableNumber" placeholder="Enter table number" {...form.register("tableNumber")} />
                      </div>
                      <div>
                        <Label>Payment Method</Label>
                        <Select value={form.watch("paymentMethod")} onValueChange={(v) => form.setValue("paymentMethod", v as any)}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="cash">Cash</SelectItem>
                            <SelectItem value="card">Card</SelectItem>
                            <SelectItem value="upi">UPI</SelectItem>
                            <SelectItem value="online">Online</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label htmlFor="notes">Notes</Label>
                        <Textarea id="notes" placeholder="Any special notes..." {...form.register("notes")} />
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-end gap-3">
                    <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
                    <Button type="submit" disabled={createOrderMutation.isPending || cartItems.length === 0}>
                      {createOrderMutation.isPending ? "Creating..." : `Create Order (${formatCurrency(totals.total)})`}
                    </Button>
                  </div>
                </form>
              </TabsContent>
            </Tabs>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
