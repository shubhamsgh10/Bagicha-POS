import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Header } from "@/components/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, RefreshCw, ChevronDown, ChevronUp, User, Phone, ShoppingBag, Search, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 0 }).format(n);

const statusColors: Record<string, string> = {
  pending:   "bg-red-100 text-red-800",
  preparing: "bg-yellow-100 text-yellow-800",
  ready:     "bg-blue-100 text-blue-800",
  served:    "bg-green-100 text-green-800",
  delivered: "bg-purple-100 text-purple-800",
  cancelled: "bg-gray-100 text-gray-800",
};

function OrderDetailRow({ order, onStatusChange }: { order: any; onStatusChange: (id: number, status: string) => void }) {
  const [expanded, setExpanded] = useState(false);

  const { data: detail } = useQuery<any>({
    queryKey: ["/api/orders", String(order.id)],
    enabled: expanded,
    staleTime: 0,
  });

  const items: any[] = detail?.items || [];

  return (
    <div className="border rounded-lg overflow-hidden">
      {/* Summary row */}
      <div
        className="flex items-center justify-between p-4 cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 bg-primary/10 rounded-full flex items-center justify-center text-primary text-sm font-bold shrink-0">
            {order.orderNumber?.slice(-2)}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm">{order.orderNumber}</span>
              {order.tableNumber && (
                <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-medium">
                  Table {order.tableNumber}
                </span>
              )}
              <span className="text-xs text-muted-foreground capitalize">{order.orderType?.replace("-", " ")}</span>
            </div>
            <div className="flex items-center gap-3 mt-0.5 flex-wrap">
              {order.customerName ? (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <User className="w-3 h-3" /> {order.customerName}
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">Walk-in</span>
              )}
              {order.customerPhone && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Phone className="w-3 h-3" /> {order.customerPhone}
                </span>
              )}
              <span className="text-xs text-muted-foreground">
                {new Date(order.createdAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0 ml-3">
          <div className="text-right hidden sm:block">
            <p className="font-bold text-sm">{fmt(parseFloat(order.totalAmount || "0"))}</p>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColors[order.status] || "bg-gray-100 text-gray-700"}`}>
              {order.status}
            </span>
          </div>
          <div onClick={(e) => e.stopPropagation()}>
          <Select
            value={order.status}
            onValueChange={(v) => { onStatusChange(order.id, v); }}
          >
            <SelectTrigger className="h-7 text-xs w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["pending","preparing","ready","served","delivered","cancelled"].map(s => (
                <SelectItem key={s} value={s} className="text-xs capitalize">{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          </div>
          {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
        </div>
      </div>

      {/* Expanded detail panel */}
      {expanded && (
        <div className="border-t bg-muted/20 px-4 py-3 space-y-3">
          {/* Customer + table info */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div>
              <p className="text-muted-foreground font-medium uppercase tracking-wide mb-0.5">Customer</p>
              <p className="font-medium">{order.customerName || "—"}</p>
            </div>
            <div>
              <p className="text-muted-foreground font-medium uppercase tracking-wide mb-0.5">Phone</p>
              <p className="font-medium">{order.customerPhone || "—"}</p>
            </div>
            <div>
              <p className="text-muted-foreground font-medium uppercase tracking-wide mb-0.5">Table</p>
              <p className="font-medium">{order.tableNumber ? `Table ${order.tableNumber}` : "—"}</p>
            </div>
            <div>
              <p className="text-muted-foreground font-medium uppercase tracking-wide mb-0.5">Type</p>
              <p className="font-medium capitalize">{order.orderType?.replace("-", " ") || "—"}</p>
            </div>
          </div>

          {/* Items */}
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1.5 flex items-center gap-1">
              <ShoppingBag className="w-3 h-3" /> Items
            </p>
            {items.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">Loading…</p>
            ) : (
              <div className="rounded-lg border overflow-hidden bg-white">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted/50 border-b">
                      <th className="text-left px-3 py-1.5 font-semibold text-muted-foreground">Item</th>
                      <th className="text-center px-3 py-1.5 font-semibold text-muted-foreground w-12">Qty</th>
                      <th className="text-right px-3 py-1.5 font-semibold text-muted-foreground w-20">Price</th>
                      <th className="text-right px-3 py-1.5 font-semibold text-muted-foreground w-20">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item: any, i: number) => (
                      <tr key={i} className="border-b last:border-b-0">
                        <td className="px-3 py-1.5">
                          <span className="font-medium">{item.name || "Item"}</span>
                          {item.specialInstructions && (
                            <span className="block text-muted-foreground italic">{item.specialInstructions}</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-center">{item.quantity}</td>
                        <td className="px-3 py-1.5 text-right">{fmt(parseFloat(item.price || "0"))}</td>
                        <td className="px-3 py-1.5 text-right font-semibold">{fmt(parseFloat(item.price || "0") * item.quantity)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Totals */}
          <div className="flex justify-end">
            <div className="text-xs space-y-0.5 w-48">
              {parseFloat(order.discountAmount || "0") > 0 && (
                <div className="flex justify-between text-muted-foreground">
                  <span>Discount</span>
                  <span className="text-red-600">-{fmt(parseFloat(order.discountAmount))}</span>
                </div>
              )}
              {parseFloat(order.taxAmount || "0") > 0 && (
                <div className="flex justify-between text-muted-foreground">
                  <span>Tax</span>
                  <span>{fmt(parseFloat(order.taxAmount))}</span>
                </div>
              )}
              <div className="flex justify-between font-bold border-t pt-1 mt-1 text-sm">
                <span>Total</span>
                <span className="text-green-600">{fmt(parseFloat(order.totalAmount || "0"))}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Orders() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const { data: orders, isLoading, refetch } = useQuery({ queryKey: ["/api/orders"] });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) =>
      apiRequest("PUT", `/api/orders/${id}`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      toast({ title: "Order status updated" });
    },
    onError: () => toast({ title: "Failed to update status", variant: "destructive" }),
  });

  const q = search.trim().toLowerCase();
  const filterOrders = (list: any[]) => {
    if (!q) return list;
    return list.filter((o: any) =>
      o.orderNumber?.toLowerCase().includes(q) ||
      o.customerName?.toLowerCase().includes(q) ||
      o.customerPhone?.toLowerCase().includes(q) ||
      o.tableNumber?.toLowerCase().includes(q)
    );
  };

  const getOrdersByStatus = (status: string) =>
    filterOrders((orders as any[])?.filter((o: any) => o.status === status) || []);

  if (isLoading) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header title="Orders" description="Loading orders..." />
        <div className="min-h-0 flex-1 overflow-y-auto p-6 space-y-4">
          {[...Array(4)].map((_, i) => <div key={i} className="h-16 bg-muted rounded-lg animate-pulse" />)}
        </div>
      </div>
    );
  }

  const handleStatusChange = (id: number, status: string) =>
    updateStatusMutation.mutate({ id, status });

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <Header title="Order History" description="View and manage all restaurant orders" />

      <div className="px-6 pt-4 flex items-center gap-2">
        <Button size="sm" onClick={() => navigate("/tables")}>
          <Plus className="w-4 h-4 mr-1" /> New Order
        </Button>
        <Button size="sm" variant="outline" onClick={() => refetch()}>
          <RefreshCw className="w-4 h-4 mr-1" /> Refresh
        </Button>
        <div className="flex items-center gap-2 bg-muted border rounded-md px-3 py-1.5 flex-1 max-w-sm ml-2">
          <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by order no., customer, phone, table..."
            className="bg-transparent text-sm outline-none w-full placeholder-muted-foreground"
          />
          {search && (
            <button onClick={() => setSearch("")}>
              <X className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
            </button>
          )}
        </div>
      </div>

      <main className="min-h-0 flex-1 overflow-y-auto custom-scrollbar px-6 pt-4 pb-6">
        <Tabs defaultValue="all" className="w-full">
          <TabsList className="grid w-full grid-cols-6">
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="pending">Pending</TabsTrigger>
            <TabsTrigger value="preparing">Preparing</TabsTrigger>
            <TabsTrigger value="ready">Ready</TabsTrigger>
            <TabsTrigger value="served">Served</TabsTrigger>
            <TabsTrigger value="delivered">Delivered</TabsTrigger>
          </TabsList>

          <TabsContent value="all" className="mt-4">
            <div className="space-y-2">
              {filterOrders((orders as any[]) || []).length === 0 && (
                <div className="text-center py-12 text-muted-foreground">No orders found</div>
              )}
              {filterOrders((orders as any[]) || []).map((order: any) => (
                <OrderDetailRow key={order.id} order={order} onStatusChange={handleStatusChange} />
              ))}
            </div>
          </TabsContent>

          {["pending","preparing","ready","served","delivered","cancelled"].map((status) => (
            <TabsContent key={status} value={status} className="mt-4">
              <div className="space-y-2">
                {getOrdersByStatus(status).length === 0 && (
                  <div className="text-center py-12 text-muted-foreground capitalize">No {status} orders</div>
                )}
                {getOrdersByStatus(status).map((order: any) => (
                  <OrderDetailRow key={order.id} order={order} onStatusChange={handleStatusChange} />
                ))}
              </div>
            </TabsContent>
          ))}
        </Tabs>
      </main>
    </div>
  );
}
