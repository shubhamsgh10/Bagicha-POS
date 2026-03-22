import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Header } from "@/components/Header";
import { OrderCard } from "@/components/ui/order-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ORDER_STATUS } from "@/lib/constants";
import { Eye, Plus, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

export default function Orders() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { data: orders, isLoading, refetch } = useQuery({
    queryKey: ['/api/orders'],
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) =>
      apiRequest("PUT", `/api/orders/${id}`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      toast({ title: "Order status updated" });
    },
    onError: () => toast({ title: "Failed to update status", variant: "destructive" }),
  });

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', { 
      style: 'currency', 
      currency: 'INR',
      minimumFractionDigits: 0
    }).format(amount);
  };

  const getOrdersByStatus = (status: string) => {
    return orders?.filter((order: any) => order.status === status) || [];
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header title="Orders" description="Loading orders..." />
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <div className="animate-pulse space-y-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-20 bg-muted rounded-lg"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const statusColors: Record<string, string> = {
    pending: "bg-red-100 text-red-800",
    preparing: "bg-yellow-100 text-yellow-800",
    ready: "bg-blue-100 text-blue-800",
    served: "bg-green-100 text-green-800",
    delivered: "bg-purple-100 text-purple-800",
    cancelled: "bg-gray-100 text-gray-800",
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <Header
        title="Order History"
        description="View and manage all restaurant orders"
      />
      <div className="px-6 pt-4 flex gap-2">
        <Button size="sm" onClick={() => navigate("/pos")}>
          <Plus className="w-4 h-4 mr-1" /> New Order
        </Button>
        <Button size="sm" variant="outline" onClick={() => refetch()}>
          <RefreshCw className="w-4 h-4 mr-1" /> Refresh
        </Button>
      </div>

      <main className="min-h-0 flex-1 overflow-y-auto custom-scrollbar px-6 pt-4 pb-6">
        <Tabs defaultValue="all" className="w-full">
          <TabsList className="grid w-full grid-cols-6">
            <TabsTrigger value="all">All Orders</TabsTrigger>
            <TabsTrigger value="pending">Pending</TabsTrigger>
            <TabsTrigger value="preparing">Preparing</TabsTrigger>
            <TabsTrigger value="ready">Ready</TabsTrigger>
            <TabsTrigger value="served">Served</TabsTrigger>
            <TabsTrigger value="delivered">Delivered</TabsTrigger>
          </TabsList>

          <TabsContent value="all" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle>All Orders</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {orders?.map((order: any) => (
                    <div key={order.id} className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/30 transition-colors">
                      <div className="flex items-center space-x-4">
                        <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center text-primary text-sm font-bold">
                          {order.orderNumber.slice(-2)}
                        </div>
                        <div>
                          <h3 className="font-medium">{order.orderNumber}</h3>
                          <p className="text-sm text-muted-foreground">
                            {order.customerName || 'Walk-in'} · {order.orderType}
                            {order.tableNumber ? ` · Table ${order.tableNumber}` : ""}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(order.createdAt).toLocaleString()}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <p className="font-semibold">{formatCurrency(parseFloat(order.totalAmount))}</p>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColors[order.status] || ""}`}>
                            {order.status}
                          </span>
                        </div>
                        <Select
                          value={order.status}
                          onValueChange={(v) => updateStatusMutation.mutate({ id: order.id, status: v })}
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
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {Object.values(ORDER_STATUS).map((status) => (
            <TabsContent key={status} value={status} className="mt-6">
              <Card>
                <CardHeader>
                  <CardTitle className="capitalize">{status} Orders</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {getOrdersByStatus(status).map((order: any) => (
                      <OrderCard
                        key={order.id}
                        orderNumber={order.orderNumber}
                        customerName={order.customerName}
                        items={`${order.orderType} order`}
                        amount={formatCurrency(parseFloat(order.totalAmount))}
                        status={order.status}
                        source={order.source}
                        tableNumber={order.tableNumber}
                      />
                    ))}
                    {getOrdersByStatus(status).length === 0 && (
                      <div className="text-center py-8 text-muted-foreground">
                        No {status} orders found
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          ))}
        </Tabs>
      </main>
    </div>
  );
}
