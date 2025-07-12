import { useQuery } from "@tanstack/react-query";
import { Header } from "@/components/Header";
import { OrderCard } from "@/components/ui/order-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ORDER_STATUS } from "@/lib/constants";
import { Eye } from "lucide-react";

export default function Orders() {
  const { data: orders, isLoading } = useQuery({
    queryKey: ['/api/orders'],
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
      <div className="flex-1 overflow-hidden">
        <Header title="Orders" description="Loading orders..." />
        <div className="flex-1 overflow-y-auto p-6">
          <div className="animate-pulse space-y-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-20 bg-muted rounded-lg"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-hidden">
      <Header 
        title="Orders" 
        description="Manage all restaurant orders and track their status"
      />

      <main className="flex-1 overflow-y-auto custom-scrollbar p-6">
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
                    <div key={order.id} className="flex items-center justify-between p-4 border rounded-lg">
                      <div className="flex items-center space-x-4">
                        <div className="w-10 h-10 bg-primary rounded-full flex items-center justify-center text-white text-sm font-medium">
                          {order.orderNumber.slice(-2)}
                        </div>
                        <div>
                          <h3 className="font-medium">{order.orderNumber}</h3>
                          <p className="text-sm text-muted-foreground">
                            {order.customerName || 'Walk-in Customer'} • {order.orderType}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(order.createdAt).toLocaleString()}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-4">
                        <div className="text-right">
                          <p className="font-semibold">{formatCurrency(parseFloat(order.totalAmount))}</p>
                          <Badge variant="outline" className="text-xs">
                            {order.status}
                          </Badge>
                        </div>
                        <Button size="sm" variant="outline">
                          <Eye className="w-4 h-4 mr-2" />
                          View
                        </Button>
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
