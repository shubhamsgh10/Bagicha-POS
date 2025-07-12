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
  DialogDescription 
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Minus, ShoppingCart, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { ORDER_TYPES, PAYMENT_METHODS } from "@/lib/constants";

const orderSchema = z.object({
  customerName: z.string().optional(),
  customerPhone: z.string().optional(),
  orderType: z.enum(["dine-in", "takeaway", "delivery"]),
  tableNumber: z.string().optional(),
  paymentMethod: z.enum(["cash", "card", "upi", "online"]).optional(),
  notes: z.string().optional(),
});

type OrderForm = z.infer<typeof orderSchema>;

interface OrderItem {
  id: number;
  name: string;
  price: number;
  quantity: number;
  specialInstructions?: string;
}

interface NewOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function NewOrderModal({ isOpen, onClose }: NewOrderModalProps) {
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const { toast } = useToast();

  const form = useForm<OrderForm>({
    resolver: zodResolver(orderSchema),
    defaultValues: {
      orderType: "dine-in",
      paymentMethod: "cash",
    },
  });

  const { data: categories } = useQuery({
    queryKey: ['/api/categories'],
  });

  const { data: menuItems } = useQuery({
    queryKey: ['/api/menu'],
  });

  const createOrderMutation = useMutation({
    mutationFn: async (orderData: any) => {
      return await apiRequest({
        url: '/api/orders',
        method: 'POST',
        data: orderData,
      });
    },
    onSuccess: () => {
      toast({
        title: "Order Created",
        description: "New order has been created successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/orders'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/stats'] });
      onClose();
      form.reset();
      setOrderItems([]);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create order",
        variant: "destructive",
      });
    },
  });

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', { 
      style: 'currency', 
      currency: 'INR',
      minimumFractionDigits: 0
    }).format(amount);
  };

  const addToOrder = (menuItem: any) => {
    const existingItem = orderItems.find(item => item.id === menuItem.id);
    if (existingItem) {
      setOrderItems(items => 
        items.map(item => 
          item.id === menuItem.id 
            ? { ...item, quantity: item.quantity + 1 }
            : item
        )
      );
    } else {
      setOrderItems(items => [...items, {
        id: menuItem.id,
        name: menuItem.name,
        price: parseFloat(menuItem.price),
        quantity: 1,
      }]);
    }
  };

  const removeFromOrder = (itemId: number) => {
    setOrderItems(items => items.filter(item => item.id !== itemId));
  };

  const updateQuantity = (itemId: number, newQuantity: number) => {
    if (newQuantity <= 0) {
      removeFromOrder(itemId);
      return;
    }
    setOrderItems(items => 
      items.map(item => 
        item.id === itemId 
          ? { ...item, quantity: newQuantity }
          : item
      )
    );
  };

  const updateInstructions = (itemId: number, instructions: string) => {
    setOrderItems(items => 
      items.map(item => 
        item.id === itemId 
          ? { ...item, specialInstructions: instructions }
          : item
      )
    );
  };

  const calculateTotal = () => {
    const subtotal = orderItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const tax = subtotal * 0.18; // 18% GST
    return {
      subtotal,
      tax,
      total: subtotal + tax,
    };
  };

  const filteredMenuItems = menuItems?.filter((item: any) => {
    if (selectedCategory === "all") return true;
    return item.categoryId === parseInt(selectedCategory);
  });

  const onSubmit = (data: OrderForm) => {
    if (orderItems.length === 0) {
      toast({
        title: "Error",
        description: "Please add at least one item to the order",
        variant: "destructive",
      });
      return;
    }

    const totals = calculateTotal();
    const orderData = {
      ...data,
      totalAmount: totals.total.toFixed(2),
      taxAmount: totals.tax.toFixed(2),
      discountAmount: "0",
      items: orderItems.map(item => ({
        menuItemId: item.id,
        quantity: item.quantity,
        price: item.price.toFixed(2),
        specialInstructions: item.specialInstructions || "",
        name: item.name,
      })),
    };

    createOrderMutation.mutate(orderData);
  };

  const totals = calculateTotal();

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle>Create New Order</DialogTitle>
          <DialogDescription>
            Add items to the order and fill in customer details
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col h-full">
          <Tabs defaultValue="menu" className="flex-1">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="menu">Menu Items</TabsTrigger>
              <TabsTrigger value="details">Order Details</TabsTrigger>
            </TabsList>

            <TabsContent value="menu" className="flex-1">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-full">
                {/* Menu Items */}
                <div className="lg:col-span-2">
                  <div className="mb-4">
                    <Label htmlFor="category">Category</Label>
                    <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Categories</SelectItem>
                        {categories?.map((category: any) => (
                          <SelectItem key={category.id} value={category.id.toString()}>
                            {category.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <ScrollArea className="h-[400px]">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {filteredMenuItems?.map((item: any) => (
                        <Card key={item.id} className="cursor-pointer hover:shadow-md transition-shadow">
                          <CardContent className="p-4">
                            <div className="flex justify-between items-start mb-2">
                              <h3 className="font-medium">{item.name}</h3>
                              <Badge variant={item.isAvailable ? "default" : "destructive"}>
                                {item.isAvailable ? "Available" : "Out of Stock"}
                              </Badge>
                            </div>
                            <p className="text-sm text-muted-foreground mb-2">{item.description}</p>
                            <div className="flex justify-between items-center">
                              <span className="font-semibold">{formatCurrency(parseFloat(item.price))}</span>
                              <Button 
                                size="sm" 
                                onClick={() => addToOrder(item)}
                                disabled={!item.isAvailable}
                              >
                                <Plus className="w-4 h-4 mr-1" />
                                Add
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </ScrollArea>
                </div>

                {/* Order Summary */}
                <div className="lg:col-span-1">
                  <Card>
                    <CardContent className="p-4">
                      <h3 className="font-medium mb-4 flex items-center">
                        <ShoppingCart className="w-4 h-4 mr-2" />
                        Order Summary ({orderItems.length} items)
                      </h3>
                      
                      <ScrollArea className="h-[300px] mb-4">
                        <div className="space-y-3">
                          {orderItems.map((item) => (
                            <div key={item.id} className="border rounded-lg p-3">
                              <div className="flex justify-between items-start mb-2">
                                <span className="font-medium text-sm">{item.name}</span>
                                <Button 
                                  size="sm" 
                                  variant="ghost"
                                  onClick={() => removeFromOrder(item.id)}
                                >
                                  <Trash2 className="w-3 h-3" />
                                </Button>
                              </div>
                              
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center space-x-2">
                                  <Button 
                                    size="sm" 
                                    variant="outline"
                                    onClick={() => updateQuantity(item.id, item.quantity - 1)}
                                  >
                                    <Minus className="w-3 h-3" />
                                  </Button>
                                  <span className="w-8 text-center">{item.quantity}</span>
                                  <Button 
                                    size="sm" 
                                    variant="outline"
                                    onClick={() => updateQuantity(item.id, item.quantity + 1)}
                                  >
                                    <Plus className="w-3 h-3" />
                                  </Button>
                                </div>
                                <span className="font-medium">
                                  {formatCurrency(item.price * item.quantity)}
                                </span>
                              </div>
                              
                              <Input
                                placeholder="Special instructions..."
                                value={item.specialInstructions || ""}
                                onChange={(e) => updateInstructions(item.id, e.target.value)}
                                className="text-xs"
                              />
                            </div>
                          ))}
                        </div>
                      </ScrollArea>

                      <Separator className="my-4" />
                      
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <span>Subtotal:</span>
                          <span>{formatCurrency(totals.subtotal)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Tax (18%):</span>
                          <span>{formatCurrency(totals.tax)}</span>
                        </div>
                        <div className="flex justify-between font-bold text-lg">
                          <span>Total:</span>
                          <span>{formatCurrency(totals.total)}</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="details" className="flex-1">
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="customerName">Customer Name</Label>
                      <Input
                        id="customerName"
                        placeholder="Enter customer name"
                        {...form.register("customerName")}
                      />
                    </div>
                    
                    <div>
                      <Label htmlFor="customerPhone">Customer Phone</Label>
                      <Input
                        id="customerPhone"
                        placeholder="Enter phone number"
                        {...form.register("customerPhone")}
                      />
                    </div>
                    
                    <div>
                      <Label htmlFor="orderType">Order Type</Label>
                      <Select 
                        value={form.watch("orderType")} 
                        onValueChange={(value) => form.setValue("orderType", value as any)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select order type" />
                        </SelectTrigger>
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
                      <Input
                        id="tableNumber"
                        placeholder="Enter table number"
                        {...form.register("tableNumber")}
                      />
                    </div>
                    
                    <div>
                      <Label htmlFor="paymentMethod">Payment Method</Label>
                      <Select 
                        value={form.watch("paymentMethod")} 
                        onValueChange={(value) => form.setValue("paymentMethod", value as any)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select payment method" />
                        </SelectTrigger>
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
                      <Textarea
                        id="notes"
                        placeholder="Any special notes for the order..."
                        {...form.register("notes")}
                      />
                    </div>
                  </div>
                </div>

                <div className="flex justify-end space-x-4">
                  <Button type="button" variant="outline" onClick={onClose}>
                    Cancel
                  </Button>
                  <Button 
                    type="submit" 
                    disabled={createOrderMutation.isPending || orderItems.length === 0}
                  >
                    {createOrderMutation.isPending ? "Creating..." : "Create Order"}
                  </Button>
                </div>
              </form>
            </TabsContent>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}