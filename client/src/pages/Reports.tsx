import { useQuery } from "@tanstack/react-query";
import { Header } from "@/components/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { DollarSign, TrendingUp, ShoppingCart, Users, Download, Calendar } from "lucide-react";

export default function Reports() {
  const { data: salesReport, isLoading } = useQuery({
    queryKey: ['/api/reports/sales'],
  });

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', { 
      style: 'currency', 
      currency: 'INR',
      minimumFractionDigits: 0
    }).format(amount);
  };

  // Mock data for charts
  const salesData = [
    { name: 'Mon', sales: 12000 },
    { name: 'Tue', sales: 19000 },
    { name: 'Wed', sales: 15000 },
    { name: 'Thu', sales: 22000 },
    { name: 'Fri', sales: 28000 },
    { name: 'Sat', sales: 35000 },
    { name: 'Sun', sales: 31000 },
  ];

  const topItems = [
    { name: 'Butter Chicken', sold: 45, revenue: 14400 },
    { name: 'Biryani', sold: 38, revenue: 10640 },
    { name: 'Paneer Tikka', sold: 32, revenue: 8000 },
    { name: 'Dal Makhani', sold: 28, revenue: 5040 },
    { name: 'Naan', sold: 52, revenue: 2600 },
  ];

  if (isLoading) {
    return (
      <div className="flex-1 overflow-hidden">
        <Header title="Reports" description="Loading reports..." />
        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[...Array(4)].map((_, i) => (
              <Card key={i} className="animate-pulse">
                <CardContent className="p-4">
                  <div className="h-4 bg-muted rounded w-3/4 mb-2"></div>
                  <div className="h-8 bg-muted rounded w-1/2 mb-3"></div>
                  <div className="h-3 bg-muted rounded w-2/3"></div>
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
        title="Reports" 
        description="Analytics and insights for your restaurant performance"
      />

      <main className="flex-1 overflow-y-auto custom-scrollbar p-6">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h2 className="text-xl font-semibold">Sales Analytics</h2>
            <p className="text-muted-foreground">Today's performance overview</p>
          </div>
          <div className="flex space-x-2">
            <Button variant="outline" size="sm">
              <Calendar className="w-4 h-4 mr-2" />
              Date Range
            </Button>
            <Button variant="outline" size="sm">
              <Download className="w-4 h-4 mr-2" />
              Export
            </Button>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Total Sales</p>
                  <p className="text-2xl font-bold">
                    {formatCurrency(salesReport?.totalSales || 0)}
                  </p>
                  <p className="text-green-600 text-sm">+15% from yesterday</p>
                </div>
                <DollarSign className="w-8 h-8 text-green-500" />
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Total Orders</p>
                  <p className="text-2xl font-bold">{salesReport?.totalOrders || 0}</p>
                  <p className="text-green-600 text-sm">+8% from yesterday</p>
                </div>
                <ShoppingCart className="w-8 h-8 text-blue-500" />
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Average Order</p>
                  <p className="text-2xl font-bold">
                    {formatCurrency(salesReport?.avgOrderValue || 0)}
                  </p>
                  <p className="text-green-600 text-sm">+3% from yesterday</p>
                </div>
                <TrendingUp className="w-8 h-8 text-orange-500" />
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Customers</p>
                  <p className="text-2xl font-bold">47</p>
                  <p className="text-green-600 text-sm">+12% from yesterday</p>
                </div>
                <Users className="w-8 h-8 text-purple-500" />
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="sales" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="sales">Sales Chart</TabsTrigger>
            <TabsTrigger value="items">Top Items</TabsTrigger>
            <TabsTrigger value="orders">Order Details</TabsTrigger>
          </TabsList>

          <TabsContent value="sales" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle>Weekly Sales Performance</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={salesData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis />
                      <Tooltip 
                        formatter={(value) => [formatCurrency(value as number), 'Sales']}
                      />
                      <Bar dataKey="sales" fill="hsl(var(--primary))" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="items" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle>Top Selling Items</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {topItems.map((item, index) => (
                    <div key={item.name} className="flex items-center justify-between p-4 bg-muted rounded-lg">
                      <div className="flex items-center space-x-4">
                        <div className="w-8 h-8 bg-primary rounded-full flex items-center justify-center text-white text-sm font-bold">
                          {index + 1}
                        </div>
                        <div>
                          <h4 className="font-medium">{item.name}</h4>
                          <p className="text-sm text-muted-foreground">{item.sold} units sold</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold">{formatCurrency(item.revenue)}</p>
                        <Badge variant="secondary" className="text-xs">
                          {((item.revenue / salesReport?.totalSales || 1) * 100).toFixed(1)}%
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="orders" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle>Recent Orders</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {salesReport?.orders?.slice(0, 10).map((order: any) => (
                    <div key={order.id} className="flex items-center justify-between p-4 border rounded-lg">
                      <div>
                        <h4 className="font-medium">{order.orderNumber}</h4>
                        <p className="text-sm text-muted-foreground">
                          {order.customerName || 'Walk-in'} • {order.orderType}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(order.createdAt).toLocaleString()}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold">{formatCurrency(parseFloat(order.totalAmount))}</p>
                        <Badge variant="outline" className="text-xs">
                          {order.paymentMethod}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
