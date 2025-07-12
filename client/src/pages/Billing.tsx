import { useQuery } from "@tanstack/react-query";
import { Header } from "@/components/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Receipt, CreditCard, DollarSign, Printer } from "lucide-react";

export default function Billing() {
  const { data: orders, isLoading } = useQuery({
    queryKey: ['/api/orders'],
    select: (data) => data.filter((order: any) => 
      order.status === 'ready' || order.status === 'served'
    ),
  });

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', { 
      style: 'currency', 
      currency: 'INR',
      minimumFractionDigits: 0
    }).format(amount);
  };

  const getPaymentStatusColor = (status: string) => {
    switch (status) {
      case 'paid':
        return 'bg-green-500';
      case 'pending':
        return 'bg-yellow-500';
      case 'refunded':
        return 'bg-red-500';
      default:
        return 'bg-gray-500';
    }
  };

  if (isLoading) {
    return (
      <div className="flex-1 overflow-hidden">
        <Header title="Billing" description="Loading billing information..." />
        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {[...Array(4)].map((_, i) => (
              <Card key={i} className="animate-pulse">
                <CardContent className="p-4">
                  <div className="h-4 bg-muted rounded w-3/4 mb-2"></div>
                  <div className="h-3 bg-muted rounded w-1/2 mb-3"></div>
                  <div className="h-2 bg-muted rounded w-full"></div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-hidden">
      <Header 
        title="Billing" 
        description="Process payments and manage billing for orders"
      />

      <main className="flex-1 overflow-y-auto custom-scrollbar p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {orders?.map((order: any) => (
            <Card key={order.id} className="bg-card shadow-sm">
              <CardHeader className="pb-3">
                <div className="flex justify-between items-start">
                  <div>
                    <CardTitle className="text-base">{order.orderNumber}</CardTitle>
                    <p className="text-sm text-muted-foreground">
                      {order.customerName || 'Walk-in Customer'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(order.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <Badge className={`${getPaymentStatusColor(order.paymentStatus)} text-white`}>
                    {order.paymentStatus}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Order Type</span>
                    <span className="text-sm font-medium capitalize">{order.orderType}</span>
                  </div>
                  
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Table</span>
                    <span className="text-sm font-medium">
                      {order.tableNumber || 'N/A'}
                    </span>
                  </div>
                  
                  <Separator />
                  
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Subtotal</span>
                    <span className="text-sm font-medium">
                      {formatCurrency(parseFloat(order.totalAmount) - parseFloat(order.taxAmount))}
                    </span>
                  </div>
                  
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Tax</span>
                    <span className="text-sm font-medium">
                      {formatCurrency(parseFloat(order.taxAmount))}
                    </span>
                  </div>
                  
                  {order.discountAmount && parseFloat(order.discountAmount) > 0 && (
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Discount</span>
                      <span className="text-sm font-medium text-green-600">
                        -{formatCurrency(parseFloat(order.discountAmount))}
                      </span>
                    </div>
                  )}
                  
                  <Separator />
                  
                  <div className="flex justify-between items-center">
                    <span className="font-medium">Total</span>
                    <span className="font-bold text-lg">
                      {formatCurrency(parseFloat(order.totalAmount))}
                    </span>
                  </div>
                  
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Payment Method</span>
                    <span className="text-sm font-medium capitalize">
                      {order.paymentMethod || 'Not specified'}
                    </span>
                  </div>
                  
                  <Separator />
                  
                  <div className="flex space-x-2">
                    {order.paymentStatus === 'pending' && (
                      <Button size="sm" className="flex-1">
                        <CreditCard className="w-3 h-3 mr-1" />
                        Process Payment
                      </Button>
                    )}
                    
                    <Button size="sm" variant="outline" className="flex-1">
                      <Receipt className="w-3 h-3 mr-1" />
                      View Receipt
                    </Button>
                    
                    <Button size="sm" variant="outline">
                      <Printer className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          
          {orders?.length === 0 && (
            <div className="col-span-full text-center py-12">
              <DollarSign className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No orders ready for billing</h3>
              <p className="text-muted-foreground">
                Orders ready for payment will appear here
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
