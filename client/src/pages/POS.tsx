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
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Minus, X, ShoppingCart, Search, Trash2 } from "lucide-react";
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

interface SizeOption { size: string; price: number; }
interface AddonOption { name: string; price: number; }
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

const fmt = (n: number) => `₹${n.toFixed(0)}`;

export default function POS() {
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<number | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [discount, setDiscount] = useState(0);

  // Picker state (size + addons)
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
  const { data: settings } = useQuery<any>({ queryKey: ["/api/settings"] });
  const taxRate = (settings?.taxRate ?? 18) / 100;

  const createOrderMutation = useMutation({
    mutationFn: async (data: any) => apiRequest("POST", "/api/orders", data),
    onSuccess: () => {
      toast({ title: "Order Placed!", description: "Order created and sent to kitchen" });
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/kot"] });
      setCartItems([]);
      setDiscount(0);
      form.reset({ orderType: "dine-in", paymentMethod: "cash" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to place order", description: error.message || "Something went wrong", variant: "destructive" });
    },
  });

  // ── Picker helpers ──────────────────────────────────────────────────────────

  const openPicker = (item: any) => {
    setPickerItem(item);
    setChosenSize(null);
    setChosenAddons([]);
  };
  const closePicker = () => { setPickerItem(null); setChosenSize(null); setChosenAddons([]); };

  const toggleAddon = (addon: AddonOption) => {
    setChosenAddons(prev =>
      prev.some(a => a.name === addon.name)
        ? prev.filter(a => a.name !== addon.name)
        : [...prev, addon]
    );
  };

  const pickerHasSizes = pickerItem && Array.isArray(pickerItem.sizes) && pickerItem.sizes.length > 0;
  const pickerBasePrice = pickerHasSizes && chosenSize ? Number(chosenSize.price) : parseFloat(pickerItem?.price || "0");
  const pickerTotal = pickerBasePrice + chosenAddons.reduce((s, a) => s + Number(a.price), 0);

  const confirmAndAdd = () => {
    if (!pickerItem || (pickerHasSizes && !chosenSize)) return;
    const basePrice = pickerHasSizes ? Number(chosenSize!.price) : parseFloat(pickerItem.price || "0");
    const addonTotal = chosenAddons.reduce((s, a) => s + Number(a.price), 0);
    const totalPrice = basePrice + addonTotal;
    const size = chosenSize?.size;
    const sortedAddonNames = [...chosenAddons].map(a => a.name).sort().join(",");
    const cartKey = `${pickerItem.id}-${size || ""}-${sortedAddonNames}`;

    setCartItems(prev => {
      const existing = prev.find(c => c.cartKey === cartKey);
      if (existing) return prev.map(c => c.cartKey === cartKey ? { ...c, quantity: c.quantity + 1 } : c);
      return [...prev, { cartKey, id: pickerItem.id, name: pickerItem.name, basePrice, addons: chosenAddons, totalPrice, quantity: 1, size }];
    });
    closePicker();
  };

  // ── Cart helpers ────────────────────────────────────────────────────────────

  const directAddItem = (item: any) => {
    const basePrice = parseFloat(item.price || "0");
    const cartKey = `${item.id}`;
    setCartItems(prev => {
      const existing = prev.find(c => c.cartKey === cartKey);
      if (existing) return prev.map(c => c.cartKey === cartKey ? { ...c, quantity: c.quantity + 1 } : c);
      return [...prev, { cartKey, id: item.id, name: item.name, basePrice, addons: [], totalPrice: basePrice, quantity: 1 }];
    });
  };

  const removeFromCart = (cartKey: string) => setCartItems(prev => prev.filter(c => c.cartKey !== cartKey));
  const updateQty = (cartKey: string, qty: number) => {
    if (qty <= 0) { removeFromCart(cartKey); return; }
    setCartItems(prev => prev.map(c => c.cartKey === cartKey ? { ...c, quantity: qty } : c));
  };

  // ── Filter ──────────────────────────────────────────────────────────────────

  const filteredItems = menuItems?.filter((item: any) => {
    const matchCat = selectedCategory === "all" || item.categoryId === selectedCategory;
    const matchSearch = !searchQuery || item.name.toLowerCase().includes(searchQuery.toLowerCase());
    return matchCat && matchSearch;
  });

  // ── Totals ──────────────────────────────────────────────────────────────────

  const subtotal = cartItems.reduce((s, i) => s + i.totalPrice * i.quantity, 0);
  const discountAmt = Math.min(discount, subtotal);
  const taxable = subtotal - discountAmt;
  const tax = taxable * taxRate;
  const total = taxable + tax;

  const onSubmit = (data: OrderForm) => {
    if (cartItems.length === 0) {
      toast({ title: "Cart is empty", description: "Add items before placing order", variant: "destructive" });
      return;
    }
    createOrderMutation.mutate({
      ...data,
      totalAmount: total.toFixed(2),
      taxAmount: tax.toFixed(2),
      discountAmount: discountAmt.toFixed(2),
      items: cartItems.map(c => ({
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

  // ── UI ──────────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Picker Dialog ───────────────────────────────────────────────────── */}
      <Dialog open={!!pickerItem} onOpenChange={closePicker}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{pickerItem?.name}</DialogTitle>
            <DialogDescription>Customize your order</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            {pickerHasSizes && (
              <div>
                <p className="font-medium text-sm mb-2">Select Size</p>
                <div className="space-y-2">
                  {pickerItem.sizes.map((s: SizeOption) => {
                    const isChosen = chosenSize?.size === s.size;
                    return (
                      <label key={s.size} className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors ${isChosen ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"}`}>
                        <div className="flex items-center gap-3">
                          <input type="radio" name="picker-size" checked={isChosen} onChange={() => setChosenSize({ size: s.size, price: Number(s.price) })} className="accent-primary w-4 h-4" />
                          <span className="font-medium">{s.size}</span>
                        </div>
                        <span className="font-semibold text-primary">{fmt(Number(s.price))}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
            {pickerItem?.addonsEnabled && Array.isArray(pickerItem.addons) && pickerItem.addons.length > 0 && (
              <div>
                <p className="font-medium text-sm mb-2">Add Extras</p>
                <div className="space-y-2">
                  {pickerItem.addons.map((a: AddonOption) => {
                    const isChecked = chosenAddons.some(ca => ca.name === a.name);
                    return (
                      <label key={a.name} className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors ${isChecked ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"}`}>
                        <div className="flex items-center gap-3">
                          <input type="checkbox" checked={isChecked} onChange={() => toggleAddon({ name: a.name, price: Number(a.price) })} className="accent-primary w-4 h-4" />
                          <span className="font-medium">{a.name}</span>
                        </div>
                        <span className="text-sm font-semibold text-primary">+{fmt(Number(a.price))}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="border-t pt-3 flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Total</span>
              <span className="font-bold text-base">{fmt(pickerTotal)}</span>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={closePicker}>Cancel</Button>
            <Button disabled={!!(pickerHasSizes && !chosenSize)} onClick={confirmAndAdd}>
              Add to Cart
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── LEFT: Category Panel ─────────────────────────────────────────────── */}
      <div className="w-44 border-r bg-muted/20 flex flex-col shrink-0 overflow-hidden">
        <div className="p-3 border-b font-semibold text-sm bg-card shrink-0">Categories</div>
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            <button
              onClick={() => setSelectedCategory("all")}
              className={`w-full text-left px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${selectedCategory === "all" ? "bg-primary text-primary-foreground" : "hover:bg-muted text-foreground"}`}
            >
              All Items
            </button>
            {categories?.map((cat: any) => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={`w-full text-left px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${selectedCategory === cat.id ? "bg-primary text-primary-foreground" : "hover:bg-muted text-foreground"}`}
              >
                {cat.name}
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* ── CENTER: Menu Items ───────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="p-3 border-b bg-card flex items-center gap-2 shrink-0">
          <Search className="w-4 h-4 text-muted-foreground shrink-0" />
          <Input
            placeholder="Search menu items..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="border-0 p-0 h-8 focus-visible:ring-0 shadow-none"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery("")} className="text-muted-foreground hover:text-foreground shrink-0">
              <X className="w-4 h-4" />
            </button>
          )}
          <span className="text-xs text-muted-foreground shrink-0">{filteredItems?.length || 0} items</span>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-3">
            {filteredItems?.length === 0 && (
              <div className="text-center text-muted-foreground py-16 text-sm">No items found</div>
            )}
            <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">
              {filteredItems?.map((item: any) => {
                const hasSizes = Array.isArray(item.sizes) && item.sizes.length > 0;
                const hasAddons = item.addonsEnabled && Array.isArray(item.addons) && item.addons.length > 0;
                const needsPicker = hasSizes || hasAddons;
                const isAvailable = item.isAvailable !== false;

                return (
                  <button
                    key={item.id}
                    disabled={!isAvailable}
                    onClick={() => isAvailable && (needsPicker ? openPicker(item) : directAddItem(item))}
                    className={`text-left border rounded-xl p-3 transition-all bg-card ${
                      isAvailable
                        ? "hover:border-primary hover:bg-primary/5 hover:shadow-sm cursor-pointer active:scale-95"
                        : "opacity-40 cursor-not-allowed"
                    }`}
                  >
                    <div className="font-semibold text-sm mb-1 leading-tight line-clamp-2">{item.name}</div>
                    {item.description && (
                      <div className="text-xs text-muted-foreground mb-2 line-clamp-2">{item.description}</div>
                    )}
                    {hasSizes ? (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {item.sizes.map((s: SizeOption) => (
                          <span key={s.size} className="text-xs bg-muted px-1.5 py-0.5 rounded-md font-medium">
                            {s.size} {fmt(Number(s.price))}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className="font-bold text-primary text-sm mt-1">{fmt(parseFloat(item.price || "0"))}</div>
                    )}
                    <div className="flex items-center gap-1 mt-1.5">
                      {!isAvailable && <Badge variant="destructive" className="text-xs py-0 px-1">Unavailable</Badge>}
                      {hasAddons && isAvailable && (
                        <span className="text-xs text-muted-foreground">Customizable</span>
                      )}
                      {needsPicker && isAvailable && (
                        <span className="ml-auto text-xs text-primary font-medium">Tap to select</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </ScrollArea>
      </div>

      {/* ── RIGHT: Cart ─────────────────────────────────────────────────────── */}
      <div className="w-80 shrink-0 border-l bg-card flex flex-col overflow-hidden">
        {/* Order info header */}
        <div className="p-3 border-b space-y-2 shrink-0">
          <h3 className="font-semibold flex items-center gap-2 text-sm">
            <ShoppingCart className="w-4 h-4" />
            New Order
            {cartItems.length > 0 && (
              <Badge className="ml-auto text-xs" variant="secondary">{cartItems.length} items</Badge>
            )}
          </h3>
          <div className="grid grid-cols-2 gap-2">
            <Select value={form.watch("orderType")} onValueChange={(v) => form.setValue("orderType", v as any)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="dine-in">Dine In</SelectItem>
                <SelectItem value="takeaway">Takeaway</SelectItem>
                <SelectItem value="delivery">Delivery</SelectItem>
              </SelectContent>
            </Select>
            <Input placeholder="Table #" {...form.register("tableNumber")} className="h-8 text-xs" />
          </div>
          <Input placeholder="Customer name (optional)" {...form.register("customerName")} className="h-8 text-xs" />
          <Input placeholder="Phone (optional)" {...form.register("customerPhone")} className="h-8 text-xs" />
        </div>

        {/* Cart items */}
        <ScrollArea className="flex-1">
          <div className="p-3 space-y-2">
            {cartItems.length === 0 && (
              <div className="text-center text-muted-foreground py-12">
                <ShoppingCart className="w-8 h-8 mx-auto mb-2 opacity-20" />
                <p className="text-sm">Tap items to add to cart</p>
              </div>
            )}
            {cartItems.map((item) => (
              <div key={item.cartKey} className="border rounded-lg p-2.5 bg-background">
                <div className="flex justify-between items-start gap-1">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium leading-tight">
                      {item.name}{item.size ? ` (${item.size})` : ""}
                    </p>
                    {item.addons.map(a => (
                      <p key={a.name} className="text-xs text-muted-foreground">+ {a.name}</p>
                    ))}
                  </div>
                  <button
                    onClick={() => removeFromCart(item.cartKey)}
                    className="text-muted-foreground hover:text-destructive transition-colors shrink-0 mt-0.5"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="outline" className="h-6 w-6 p-0 rounded-full" onClick={() => updateQty(item.cartKey, item.quantity - 1)}>
                      <Minus className="w-3 h-3" />
                    </Button>
                    <span className="text-sm font-medium w-6 text-center">{item.quantity}</span>
                    <Button size="sm" variant="outline" className="h-6 w-6 p-0 rounded-full" onClick={() => updateQty(item.cartKey, item.quantity + 1)}>
                      <Plus className="w-3 h-3" />
                    </Button>
                  </div>
                  <span className="text-sm font-bold">{fmt(item.totalPrice * item.quantity)}</span>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>

        {/* Totals + Place Order */}
        <div className="border-t p-3 space-y-2 shrink-0">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Subtotal</span>
            <span>{fmt(subtotal)}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground flex-1">Discount (₹)</span>
            <Input
              type="number"
              min="0"
              value={discount || ""}
              onChange={(e) => setDiscount(Math.max(0, parseFloat(e.target.value) || 0))}
              className="h-7 text-xs w-24 text-right"
              placeholder="0"
            />
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Tax ({settings?.taxRate ?? 18}%)</span>
            <span>{fmt(tax)}</span>
          </div>
          <Separator />
          <div className="flex justify-between font-bold text-base">
            <span>Total</span>
            <span className="text-primary">{fmt(total)}</span>
          </div>
          <Select value={form.watch("paymentMethod")} onValueChange={(v) => form.setValue("paymentMethod", v as any)}>
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Payment method" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="cash">Cash</SelectItem>
              <SelectItem value="card">Card</SelectItem>
              <SelectItem value="upi">UPI</SelectItem>
              <SelectItem value="online">Online</SelectItem>
            </SelectContent>
          </Select>
          <Button
            className="w-full font-semibold"
            disabled={cartItems.length === 0 || createOrderMutation.isPending}
            onClick={form.handleSubmit(onSubmit)}
          >
            {createOrderMutation.isPending
              ? "Placing Order..."
              : cartItems.length === 0
                ? "Add Items to Order"
                : `Place Order · ${fmt(total)}`}
          </Button>
          {cartItems.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-xs text-muted-foreground"
              onClick={() => { setCartItems([]); setDiscount(0); }}
            >
              Clear Cart
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
