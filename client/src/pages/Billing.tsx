import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Header } from "@/components/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Receipt, CreditCard, DollarSign, Printer, CheckCircle2, Clock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 0 }).format(amount);

function printBill(order: any, items: any[] = [], settings?: any) {
  const win = window.open("", "_blank", "width=450,height=700");
  if (!win) return;
  const subtotal = parseFloat(order.totalAmount) - parseFloat(order.taxAmount);
  const discount = parseFloat(order.discountAmount || "0");
  const restaurantName = settings?.restaurantName || "Bagicha Restaurant";
  const address = settings?.address || "";
  const phone = settings?.phone || "";
  const gstNumber = settings?.gstNumber || "";
  const footerNote = settings?.footerNote || "Thank you for dining with us!";

  win.document.write(`
    <html>
      <head>
        <title>Bill - ${order.orderNumber}</title>
        <style>
          body { font-family: monospace; font-size: 13px; margin: 0; padding: 16px; }
          h2 { text-align: center; font-size: 20px; margin: 0 0 4px; }
          .center { text-align: center; }
          .divider { border-top: 1px dashed #000; margin: 10px 0; }
          .row { display: flex; justify-content: space-between; padding: 2px 0; }
          .bold { font-weight: bold; }
          .large { font-size: 16px; }
          .footer { text-align: center; margin-top: 16px; font-size: 12px; }
        </style>
      </head>
      <body>
        <h2>${restaurantName.toUpperCase()}</h2>
        ${address ? `<div class="center" style="font-size:11px">${address}</div>` : ""}
        ${phone ? `<div class="center" style="font-size:11px">Ph: ${phone}</div>` : ""}
        ${gstNumber ? `<div class="center" style="font-size:11px">GSTIN: ${gstNumber}</div>` : ""}
        <div style="margin-bottom:8px"></div>
        <div class="divider"></div>
        <div class="row"><span>Order #</span><span class="bold">${order.orderNumber}</span></div>
        <div class="row"><span>Type</span><span>${order.orderType}</span></div>
        ${order.tableNumber ? `<div class="row"><span>Table</span><span>${order.tableNumber}</span></div>` : ""}
        ${order.customerName ? `<div class="row"><span>Customer</span><span>${order.customerName}</span></div>` : ""}
        <div class="row"><span>Date</span><span>${new Date(order.createdAt).toLocaleString()}</span></div>
        <div class="divider"></div>
        <div class="bold" style="margin-bottom:6px">ITEMS</div>
        ${items.length > 0
          ? items.map((item: any) => `
            <div class="row">
              <span>${item.name || "Item"} × ${item.quantity}</span>
              <span>₹${(parseFloat(item.price) * item.quantity).toFixed(0)}</span>
            </div>
          `).join("")
          : "<div>—</div>"
        }
        <div class="divider"></div>
        <div class="row"><span>Subtotal</span><span>₹${subtotal.toFixed(0)}</span></div>
        ${discount > 0 ? `<div class="row"><span>Discount</span><span>-₹${discount.toFixed(0)}</span></div>` : ""}
        <div class="row"><span>Tax (GST)</span><span>₹${parseFloat(order.taxAmount).toFixed(0)}</span></div>
        <div class="divider"></div>
        <div class="row bold large"><span>TOTAL</span><span>₹${parseFloat(order.totalAmount).toFixed(0)}</span></div>
        <div class="row" style="margin-top:4px"><span>Payment</span><span>${order.paymentMethod || "—"}</span></div>
        <div class="footer">
          <div class="divider"></div>
          ${footerNote}<br>
          Please visit again
        </div>
      </body>
    </html>
  `);
  win.document.close();
  win.focus();
  win.print();
  win.close();
}

export default function Billing() {
  const { toast } = useToast();
  const [payingOrder, setPayingOrder] = useState<any | null>(null);
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
  const [orderItems, setOrderItems] = useState<any[]>([]);

  const { data: settings } = useQuery<any>({ queryKey: ["/api/settings"] });

  const { data: orders, isLoading } = useQuery({
    queryKey: ["/api/orders"],
    select: (data: any[]) =>
      data.filter((o: any) => ["pending", "preparing", "ready", "served"].includes(o.status)),
  });

  const processPaymentMutation = useMutation({
    mutationFn: async ({ id, method }: { id: number; method: string }) =>
      apiRequest("POST", `/api/orders/${id}/payment`, { paymentMethod: method }),
    onSuccess: (_, vars) => {
      toast({ title: "Payment processed!", description: "Printing bill..." });
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      fetch('/api/print/bill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: vars.id }),
        credentials: 'include',
      }).then(res => res.json()).then(() => {
        toast({ title: "Bill printed!" });
      }).catch(() => {});
      setPayingOrder(null);
    },
    onError: () => {
      toast({ title: "Payment failed", description: "Could not process payment", variant: "destructive" });
    },
  });

  const fetchAndPrint = async (order: any) => {
    try {
      const data: any = await apiRequest("GET", `/api/orders/${order.id}`);
      printBill(order, data.items || [], settings);
    } catch {
      printBill(order, [], settings);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "ready":     return "bg-green-500";
      case "preparing": return "bg-yellow-500";
      case "pending":   return "bg-red-500";
      case "served":    return "bg-blue-500";
      default:          return "bg-gray-500";
    }
  };

  const getPaymentStatusColor = (status: string) => {
    switch (status) {
      case "paid":     return "bg-green-500";
      case "pending":  return "bg-yellow-500";
      case "refunded": return "bg-red-500";
      default:         return "bg-gray-500";
    }
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header title="Billing" description="Loading..." />
        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i} className="animate-pulse"><CardContent className="p-4 h-40" /></Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <Header
        title="Billing"
        description={`${orders?.length || 0} orders pending payment`}
      />

      <main className="min-h-0 flex-1 overflow-y-auto custom-scrollbar p-6">
        {orders?.length === 0 ? (
          <div className="text-center py-20">
            <DollarSign className="w-14 h-14 text-muted-foreground mx-auto mb-4 opacity-30" />
            <h3 className="text-lg font-semibold mb-1">No orders for billing</h3>
            <p className="text-muted-foreground text-sm">Ready and active orders will appear here</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {orders?.map((order: any) => (
              <Card key={order.id} className="bg-card shadow-sm hover:shadow-md transition-shadow">
                <CardHeader className="pb-2">
                  <div className="flex justify-between items-start">
                    <div>
                      <CardTitle className="text-base">{order.orderNumber}</CardTitle>
                      <p className="text-sm text-muted-foreground">
                        {order.customerName || "Walk-in Customer"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(order.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex flex-col gap-1 items-end">
                      <Badge className={`${getStatusColor(order.status)} text-white text-xs`}>
                        {order.status}
                      </Badge>
                      <Badge className={`${getPaymentStatusColor(order.paymentStatus)} text-white text-xs`}>
                        {order.paymentStatus}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>

                <CardContent>
                  <div className="space-y-1.5 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Order Type</span>
                      <span className="capitalize font-medium">{order.orderType}</span>
                    </div>
                    {order.tableNumber && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Table</span>
                        <span className="font-medium">{order.tableNumber}</span>
                      </div>
                    )}
                    <Separator className="my-2" />
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Subtotal</span>
                      <span>{formatCurrency(parseFloat(order.totalAmount) - parseFloat(order.taxAmount))}</span>
                    </div>
                    {order.discountAmount && parseFloat(order.discountAmount) > 0 && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Discount</span>
                        <span className="text-green-600">-{formatCurrency(parseFloat(order.discountAmount))}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Tax</span>
                      <span>{formatCurrency(parseFloat(order.taxAmount))}</span>
                    </div>
                    <Separator className="my-2" />
                    <div className="flex justify-between font-bold text-base">
                      <span>Total</span>
                      <span className="text-primary">{formatCurrency(parseFloat(order.totalAmount))}</span>
                    </div>
                    {order.paymentMethod && (
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Payment</span>
                        <span className="capitalize">{order.paymentMethod}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2 mt-3">
                    {order.paymentStatus !== "paid" && (
                      <Button
                        size="sm"
                        className="flex-1 text-xs"
                        onClick={() => { setPayingOrder(order); setPaymentMethod(order.paymentMethod || "cash"); }}
                      >
                        <CreditCard className="w-3 h-3 mr-1" />
                        Collect Payment
                      </Button>
                    )}
                    {order.paymentStatus === "paid" && (
                      <div className="flex-1 flex items-center gap-1.5 text-green-600 text-xs font-medium">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Paid via {order.paymentMethod}
                      </div>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs"
                      onClick={() => fetchAndPrint(order)}
                    >
                      <Printer className="w-3 h-3 mr-1" />
                      Print
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>

      {/* Payment Dialog */}
      <Dialog open={!!payingOrder} onOpenChange={() => setPayingOrder(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Collect Payment</DialogTitle>
            <DialogDescription>
              {payingOrder?.orderNumber} — {formatCurrency(parseFloat(payingOrder?.totalAmount || "0"))}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <p className="text-sm font-medium mb-2">Select Payment Method</p>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="card">Card</SelectItem>
                  <SelectItem value="upi">UPI</SelectItem>
                  <SelectItem value="online">Online</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="bg-muted/50 rounded-lg p-3 space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span>{formatCurrency(parseFloat(payingOrder?.totalAmount || "0") - parseFloat(payingOrder?.taxAmount || "0"))}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Tax</span>
                <span>{formatCurrency(parseFloat(payingOrder?.taxAmount || "0"))}</span>
              </div>
              <Separator />
              <div className="flex justify-between font-bold text-base">
                <span>Total</span>
                <span>{formatCurrency(parseFloat(payingOrder?.totalAmount || "0"))}</span>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setPayingOrder(null)}>Cancel</Button>
              <Button
                className="flex-1"
                disabled={processPaymentMutation.isPending}
                onClick={() => processPaymentMutation.mutate({ id: payingOrder.id, method: paymentMethod })}
              >
                {processPaymentMutation.isPending ? "Processing..." : "Mark as Paid"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
