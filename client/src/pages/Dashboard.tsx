import { useQuery } from "@tanstack/react-query";
import { Header } from "@/components/Header";
import { StatCard } from "@/components/ui/stat-card";
import { OrderCard } from "@/components/ui/order-card";
import { MenuItemCard } from "@/components/ui/menu-item-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  DollarSign, 
  ShoppingCart, 
  TrendingUp, 
  AlertTriangle,
  Plus,
  FileText,
  CreditCard,
  Package
} from "lucide-react";
import { useState } from "react";
import { useWebSocket } from "@/hooks/useWebSocket";

export default function Dashboard() {
  const [showNewOrderModal, setShowNewOrderModal] = useState(false);
  const { lastMessage } = useWebSocket('/ws');

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['/api/dashboard/stats'],
    refetchInterval: 30000, // Refetch every 30 seconds
  });

  const { data: orders, isLoading: ordersLoading } = useQuery({
    queryKey: ['/api/orders'],
    select: (data) => data.slice(0, 5), // Get latest 5 orders
  });

  const { data: menuItems } = useQuery({
    queryKey: ['/api/menu'],
    select: (data) => data.slice(0, 4), // Get first 4 menu items
  });

  const { data: kotTickets } = useQuery({
    queryKey: ['/api/kot'],
    select: (data) => data.filter((ticket: any) => ticket.status !== 'completed').slice(0, 3),
  });

  const openNewOrderModal = () => {
    setShowNewOrderModal(true);
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', { 
      style: 'currency', 
      currency: 'INR',
      minimumFractionDigits: 0
    }).format(amount);
  };

  const getKotStatusColor = (status: string) => {
    switch (status) {
      case 'pending':
        return 'bg-red-500';
      case 'in-progress':
        return 'bg-yellow-500';
      case 'completed':
        return 'bg-green-500';
      default:
        return 'bg-gray-500';
    }
  };

  const getKotStatusText = (status: string) => {
    switch (status) {
      case 'pending':
        return 'Urgent';
      case 'in-progress':
        return 'Cooking';
      case 'completed':
        return 'Ready';
      default:
        return status;
    }
  };

  if (statsLoading) {
    return (
      <div className="flex-1 overflow-hidden">
        <Header 
          title="Dashboard" 
          description="Loading..." 
          onNewOrder={openNewOrderModal}
        />
        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[...Array(4)].map((_, i) => (
              <Card key={i} className="bg-card shadow-sm">
                <CardContent className="p-6">
                  <div className="animate-pulse space-y-2">
                    <div className="h-4 bg-muted rounded w-3/4"></div>
                    <div className="h-8 bg-muted rounded w-1/2"></div>
                    <div className="h-3 bg-muted rounded w-2/3"></div>
                  </div>
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
        title="Dashboard" 
        description="Welcome back! Here's what's happening at Bagicha today."
        onNewOrder={openNewOrderModal}
      />

      <main className="flex-1 overflow-y-auto custom-scrollbar p-6">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <StatCard
            title="Today's Sales"
            value={formatCurrency(stats?.todaySales || 0)}
            change="+12% from yesterday"
            icon={DollarSign}
            color="success"
          />
          <StatCard
            title="Orders Today"
            value={stats?.todayOrders?.toString() || '0'}
            change="+8% from yesterday"
            icon={ShoppingCart}
            color="blue"
          />
          <StatCard
            title="Average Order"
            value={formatCurrency(stats?.avgOrderValue || 0)}
            change="+5% from yesterday"
            icon={TrendingUp}
            color="secondary"
          />
          <StatCard
            title="Low Stock Items"
            value={stats?.lowStockCount?.toString() || '0'}
            change="Needs attention"
            icon={AlertTriangle}
            color="warning"
          />
        </div>

        {/* Main Dashboard Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Recent Orders */}
          <div className="lg:col-span-2">
            <Card className="bg-card shadow-sm">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg font-semibold">Recent Orders</CardTitle>
                  <Button variant="ghost" size="sm" className="text-primary">
                    View all
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {ordersLoading ? (
                  <div className="space-y-4">
                    {[...Array(3)].map((_, i) => (
                      <div key={i} className="animate-pulse flex items-center space-x-4 p-4 bg-muted rounded-lg">
                        <div className="w-10 h-10 bg-muted-foreground/20 rounded-full"></div>
                        <div className="flex-1 space-y-2">
                          <div className="h-4 bg-muted-foreground/20 rounded w-3/4"></div>
                          <div className="h-3 bg-muted-foreground/20 rounded w-1/2"></div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-4">
                    {orders?.map((order: any) => (
                      <OrderCard
                        key={order.id}
                        orderNumber={order.orderNumber}
                        customerName={order.customerName}
                        items="Order items"
                        amount={formatCurrency(parseFloat(order.totalAmount))}
                        status={order.status}
                        source={order.source}
                        tableNumber={order.tableNumber}
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Quick Actions & KOT */}
          <div className="space-y-6">
            {/* Quick Actions */}
            <Card className="bg-card shadow-sm">
              <CardHeader>
                <CardTitle className="text-lg font-semibold">Quick Actions</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3">
                  <Button 
                    onClick={openNewOrderModal}
                    className="touch-button p-4 h-auto flex-col space-y-2"
                  >
                    <Plus className="w-6 h-6" />
                    <span className="text-sm font-medium">New Order</span>
                  </Button>
                  <Button 
                    variant="secondary"
                    className="touch-button p-4 h-auto flex-col space-y-2"
                  >
                    <FileText className="w-6 h-6" />
                    <span className="text-sm font-medium">Print KOT</span>
                  </Button>
                  <Button 
                    variant="outline"
                    className="touch-button p-4 h-auto flex-col space-y-2"
                  >
                    <CreditCard className="w-6 h-6" />
                    <span className="text-sm font-medium">Process Payment</span>
                  </Button>
                  <Button 
                    variant="outline"
                    className="touch-button p-4 h-auto flex-col space-y-2"
                  >
                    <Package className="w-6 h-6" />
                    <span className="text-sm font-medium">Check Inventory</span>
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Kitchen Orders */}
            <Card className="bg-card shadow-sm">
              <CardHeader>
                <CardTitle className="text-lg font-semibold">Kitchen Orders</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {kotTickets?.map((ticket: any) => (
                    <div key={ticket.id} className={`flex items-center justify-between p-3 rounded-lg border-l-4 ${
                      ticket.status === 'pending' ? 'bg-red-50 border-red-500' :
                      ticket.status === 'in-progress' ? 'bg-yellow-50 border-yellow-500' :
                      'bg-green-50 border-green-500'
                    }`}>
                      <div>
                        <p className="font-medium text-foreground">{ticket.kotNumber}</p>
                        <p className="text-sm text-muted-foreground">
                          {new Date(ticket.printedAt).toLocaleTimeString()}
                        </p>
                      </div>
                      <Badge className={`${getKotStatusColor(ticket.status)} text-white px-2 py-1 text-xs`}>
                        {getKotStatusText(ticket.status)}
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Popular Menu Items */}
        <div className="mt-8">
          <Card className="bg-card shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg font-semibold">Popular Menu Items</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {menuItems?.map((item: any) => (
                  <MenuItemCard
                    key={item.id}
                    id={item.id}
                    name={item.name}
                    price={formatCurrency(parseFloat(item.price))}
                    soldToday={Math.floor(Math.random() * 30) + 5} // Mock data for demo
                  />
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
