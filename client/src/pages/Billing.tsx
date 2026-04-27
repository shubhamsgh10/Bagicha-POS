import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Header } from "@/components/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import {
  Receipt, CreditCard, DollarSign, Printer, CheckCircle2,
  Tag, Star, Loader2, ShieldCheck,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 0 }).format(amount);

// ── Razorpay checkout loader ──────────────────────────────────────────────────

function ensureRazorpayScript(): Promise<boolean> {
  return new Promise(resolve => {
    if ((window as any).Razorpay) return resolve(true);
    const existing = document.querySelector<HTMLScriptElement>('script[src*="checkout.razorpay.com"]');
    if (existing) {
      existing.addEventListener("load",  () => resolve(true), { once: true });
      existing.addEventListener("error", () => resolve(false), { once: true });
      return;
    }
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.async = true;
    s.onload  = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

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

  // ── Coupon state ─────────────────────────────────────────────────────────
  const [couponCode, setCouponCode]   = useState("");
  const [couponBusy, setCouponBusy]   = useState(false);
  const [couponMsg,  setCouponMsg]    = useState<{ ok: boolean; text: string } | null>(null);

  // ── Loyalty state ────────────────────────────────────────────────────────
  const [loyalty, setLoyalty] = useState<{ balance: number; redeemable: number; rupeeValue: number; minRedeemPoints: number } | null>(null);
  const [loyaltyBusy, setLoyaltyBusy] = useState(false);

  // ── Razorpay status ──────────────────────────────────────────────────────
  const { data: rzpStatus } = useQuery<{ configured: boolean; keyId: string | null }>({
    queryKey: ["/api/razorpay/status"],
  });

  const { data: settings } = useQuery<any>({ queryKey: ["/api/settings"] });

  const { data: orders, isLoading } = useQuery({
    queryKey: ["/api/orders"],
    select: (data: any[]) =>
      data.filter((o: any) => ["pending", "preparing", "ready", "served"].includes(o.status)),
  });

  // Reload loyalty when paying order opens
  useEffect(() => {
    setLoyalty(null);
    setCouponCode("");
    setCouponMsg(null);
    if (!payingOrder) return;
    const key = payingOrder.customerPhone?.trim() || payingOrder.customerName?.trim();
    if (!key) return;
    fetch(`/api/loyalty/${encodeURIComponent(key)}`, { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setLoyalty(d); })
      .catch(() => {});
  }, [payingOrder?.id]);

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
      const res = await apiRequest("GET", `/api/orders/${order.id}`);
      const data: any = await res.json();
      printBill(order, data.items || [], settings);
    } catch {
      printBill(order, [], settings);
    }
  };

  // ── Coupon apply ────────────────────────────────────────────────────────
  async function applyCoupon() {
    if (!payingOrder || !couponCode.trim()) return;
    setCouponBusy(true);
    setCouponMsg(null);
    try {
      const customerKey = payingOrder.customerPhone?.trim() || payingOrder.customerName?.trim();
      const res = await apiRequest("POST", "/api/coupons/apply", {
        // First validate to get id
        couponId: 0,
        orderId:  payingOrder.id,
        customerKey,
      });
      // We instead use validate then apply
      void res;
    } catch {
      // ignore — fall through to two-step flow below
    }
    try {
      const customerKey = payingOrder.customerPhone?.trim() || payingOrder.customerName?.trim();
      const orderAmount = parseFloat(payingOrder.totalAmount) - parseFloat(payingOrder.taxAmount);

      const validateRes = await apiRequest("POST", "/api/coupons/validate", {
        code: couponCode.trim(),
        orderAmount,
        customerKey,
      });
      const validation: any = await validateRes.json();
      if (!validation.ok) {
        setCouponMsg({ ok: false, text: validation.reason || "Invalid coupon" });
        return;
      }

      const applyRes = await apiRequest("POST", "/api/coupons/apply", {
        couponId:    validation.couponId,
        orderId:     payingOrder.id,
        customerKey,
      });
      const applyData: any = await applyRes.json();
      if (applyData.ok) {
        setCouponMsg({ ok: true, text: `Applied — ₹${Math.round(applyData.discount)} off` });
        setPayingOrder(applyData.order);
        queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      } else {
        setCouponMsg({ ok: false, text: applyData.error || "Could not apply" });
      }
    } catch (e: any) {
      setCouponMsg({ ok: false, text: e?.message || "Coupon error" });
    } finally {
      setCouponBusy(false);
    }
  }

  // ── Loyalty redeem ──────────────────────────────────────────────────────
  async function redeemLoyalty() {
    if (!payingOrder || !loyalty || !loyalty.redeemable) return;
    const customerKey = payingOrder.customerPhone?.trim() || payingOrder.customerName?.trim();
    if (!customerKey) return;
    setLoyaltyBusy(true);
    try {
      const res = await apiRequest("POST", "/api/loyalty/redeem", {
        customerKey,
        points:  loyalty.redeemable,
        orderId: payingOrder.id,
      });
      const data: any = await res.json();
      if (data.ok) {
        toast({ title: "Points redeemed", description: `₹${data.discount} off` });
        // Re-fetch order
        const ordRes = await apiRequest("GET", `/api/orders/${payingOrder.id}`);
        const orderData: any = await ordRes.json();
        setPayingOrder(orderData);
        // Re-fetch loyalty
        const loyRes = await fetch(`/api/loyalty/${encodeURIComponent(customerKey)}`, { credentials: "include" });
        if (loyRes.ok) setLoyalty(await loyRes.json());
        queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      } else {
        toast({ title: "Redeem failed", description: data.error || "Try again", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Redeem failed", description: e?.message, variant: "destructive" });
    } finally {
      setLoyaltyBusy(false);
    }
  }

  // ── Razorpay pay ────────────────────────────────────────────────────────
  async function payViaRazorpay() {
    if (!payingOrder) return;
    if (!rzpStatus?.configured) {
      toast({
        title: "Razorpay not configured",
        description: "Add keys in Settings → Payment integration.",
        variant: "destructive",
      });
      return;
    }

    const ok = await ensureRazorpayScript();
    if (!ok) {
      toast({ title: "Could not load checkout", variant: "destructive" });
      return;
    }

    try {
      const res = await apiRequest("POST", "/api/razorpay/create-order", {
        orderId: payingOrder.id,
        amount:  parseFloat(payingOrder.totalAmount),
      });
      const rzp: any = await res.json();

      const w: any = window;
      const checkout = new w.Razorpay({
        key:        rzp.keyId,
        amount:     rzp.amount,
        currency:   rzp.currency,
        order_id:   rzp.orderId,
        name:       settings?.restaurantName ?? "Bagicha",
        description: `Order ${payingOrder.orderNumber}`,
        prefill: {
          name:    payingOrder.customerName ?? "",
          contact: payingOrder.customerPhone ?? "",
        },
        theme: { color: "#10b981" },
        handler: async (response: any) => {
          try {
            const verifyRes = await apiRequest("POST", "/api/razorpay/verify", {
              razorpay_order_id:   response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature:  response.razorpay_signature,
              posOrderId:          payingOrder.id,
            });
            const verifyData: any = await verifyRes.json();
            if (verifyData.ok) {
              toast({ title: "Payment successful!" });
              queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
              queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
              setPayingOrder(null);
              fetch('/api/print/bill', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ orderId: payingOrder.id }),
                credentials: 'include',
              }).catch(() => {});
            } else {
              toast({ title: "Verification failed", variant: "destructive" });
            }
          } catch {
            toast({ title: "Verification error", variant: "destructive" });
          }
        },
        modal: {
          ondismiss: () => {
            // user cancelled — no toast needed
          },
        },
      });
      checkout.open();
    } catch (e: any) {
      toast({ title: "Razorpay error", description: e?.message, variant: "destructive" });
    }
  }

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
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Collect Payment</DialogTitle>
            <DialogDescription>
              {payingOrder?.orderNumber} — {formatCurrency(parseFloat(payingOrder?.totalAmount || "0"))}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2 max-h-[70vh] overflow-y-auto">
            {/* ── Coupon row ── */}
            <div className="space-y-2">
              <p className="text-sm font-medium flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5" /> Coupon Code
              </p>
              <div className="flex gap-2">
                <Input
                  value={couponCode}
                  onChange={e => setCouponCode(e.target.value.toUpperCase())}
                  placeholder="Enter code (optional)"
                  className="text-sm font-mono"
                  disabled={couponBusy}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={applyCoupon}
                  disabled={couponBusy || !couponCode.trim()}
                >
                  {couponBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : "Apply"}
                </Button>
              </div>
              {couponMsg && (
                <p className={`text-xs ${couponMsg.ok ? "text-emerald-600" : "text-red-600"}`}>
                  {couponMsg.text}
                </p>
              )}
            </div>

            {/* ── Loyalty redeem ── */}
            {loyalty && loyalty.balance > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-amber-800 flex items-center gap-1.5">
                    <Star className="w-3.5 h-3.5" />
                    Loyalty: {loyalty.balance} pts available
                  </p>
                  {loyalty.redeemable > 0 && (
                    <Button
                      size="sm"
                      className="h-7 text-xs bg-amber-500 hover:bg-amber-600"
                      onClick={redeemLoyalty}
                      disabled={loyaltyBusy}
                    >
                      {loyaltyBusy
                        ? <Loader2 className="w-3 h-3 animate-spin" />
                        : `Redeem ${loyalty.redeemable} pts → ₹${loyalty.rupeeValue}`}
                    </Button>
                  )}
                </div>
                {loyalty.redeemable === 0 && (
                  <p className="text-[11px] text-amber-700">
                    Need {loyalty.minRedeemPoints - loyalty.balance} more pts to unlock redemption.
                  </p>
                )}
              </div>
            )}

            {/* ── Method ── */}
            <div>
              <p className="text-sm font-medium mb-2">Select Payment Method</p>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="card">Card</SelectItem>
                  <SelectItem value="upi">UPI (manual)</SelectItem>
                  <SelectItem value="online">Online</SelectItem>
                  <SelectItem value="due">Due / Pay later</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* ── Totals ── */}
            <div className="bg-muted/50 rounded-lg p-3 space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span>{formatCurrency(parseFloat(payingOrder?.totalAmount || "0") - parseFloat(payingOrder?.taxAmount || "0"))}</span>
              </div>
              {payingOrder && parseFloat(payingOrder.discountAmount || "0") > 0 && (
                <div className="flex justify-between text-emerald-600">
                  <span>Discount</span>
                  <span>-{formatCurrency(parseFloat(payingOrder.discountAmount))}</span>
                </div>
              )}
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

            {/* ── Action buttons ── */}
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={() => setPayingOrder(null)}>Cancel</Button>
              <Button
                disabled={processPaymentMutation.isPending}
                onClick={() => processPaymentMutation.mutate({ id: payingOrder.id, method: paymentMethod })}
              >
                {processPaymentMutation.isPending ? "Processing..." : "Mark as Paid"}
              </Button>
            </div>

            {rzpStatus?.configured && (
              <Button
                className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                onClick={payViaRazorpay}
              >
                <ShieldCheck className="w-4 h-4 mr-1.5" />
                Pay via Razorpay (UPI / Card)
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
