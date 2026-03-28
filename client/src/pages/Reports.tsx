import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Header } from "@/components/Header";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { DollarSign, TrendingUp, ShoppingCart, Users, Download, Calendar, Banknote, CreditCard, Smartphone, Clock, AlertCircle, Wifi } from "lucide-react";

export default function Reports() {
  const { data: salesReport, isLoading } = useQuery<any>({
    queryKey: ['/api/reports/sales'],
  });

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0 }).format(amount);

  const { data: weeklyData = [] } = useQuery<any[]>({ queryKey: ['/api/reports/weekly'] });
  const { data: topItemsData = [] } = useQuery<any[]>({ queryKey: ['/api/reports/top-items'] });
  const { data: paymentSummary } = useQuery<any>({ queryKey: ['/api/reports/payment-summary'] });

  const salesData = weeklyData.map((d: any) => ({ name: d.name, sales: d.sales }));
  const topItems = topItemsData.map((d: any) => ({ name: d.name, sold: d.totalSold, revenue: d.revenue }));

  const [activeTab, setActiveTab] = useState("sales");

  if (isLoading) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden bg-gradient-to-br from-slate-50 via-white to-emerald-50/30">
        <Header title="Reports" description="Loading reports..." />
        <div className="min-h-0 flex-1 overflow-y-auto p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-32 rounded-2xl bg-white/40 border border-white/30 backdrop-blur-sm animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const statCards = [
    { label: "Total Sales", value: formatCurrency(salesReport?.totalSales || 0), sub: "+15% from yesterday", icon: <DollarSign className="w-7 h-7 text-emerald-500" />, subColor: "text-emerald-600" },
    { label: "Total Orders", value: salesReport?.totalOrders || 0, sub: "+8% from yesterday", icon: <ShoppingCart className="w-7 h-7 text-blue-500" />, subColor: "text-emerald-600" },
    { label: "Average Order", value: formatCurrency(salesReport?.avgOrderValue || 0), sub: "+3% from yesterday", icon: <TrendingUp className="w-7 h-7 text-orange-500" />, subColor: "text-emerald-600" },
    { label: "Customers", value: 47, sub: "+12% from yesterday", icon: <Users className="w-7 h-7 text-purple-500" />, subColor: "text-emerald-600" },
  ];

  const tabs = [
    { id: "sales", label: "Sales Chart" },
    { id: "items", label: "Top Items" },
    { id: "orders", label: "Order Details" },
    { id: "payments", label: "Payments" },
  ];

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-gradient-to-br from-slate-50 via-white to-emerald-50/30">
      <Header title="Reports" description="Analytics and insights for your restaurant performance" />

      <main className="min-h-0 flex-1 overflow-y-auto p-6">
        {/* Toolbar */}
        <div className="mb-6 flex justify-between items-center">
          <div>
            <h2 className="text-xl font-semibold text-gray-800">Sales Analytics</h2>
            <p className="text-sm text-gray-500">Today's performance overview</p>
          </div>
          <div className="flex gap-2">
            <motion.button
              whileTap={{ scale: 0.95 }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium
                         bg-white/50 backdrop-blur-sm border border-white/40 text-gray-600
                         hover:bg-white/70 transition-all"
            >
              <Calendar className="w-4 h-4" /> Date Range
            </motion.button>
            <motion.button
              whileTap={{ scale: 0.95 }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium
                         bg-white/50 backdrop-blur-sm border border-white/40 text-gray-600
                         hover:bg-white/70 transition-all"
            >
              <Download className="w-4 h-4" /> Export
            </motion.button>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-6">
          {statCards.map((card, i) => (
            <motion.div
              key={card.label}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05, duration: 0.2 }}
              className="rounded-2xl backdrop-blur-lg bg-white/40 border border-white/30 shadow-md p-5
                         hover:scale-[1.01] hover:shadow-xl hover:shadow-emerald-500/10 hover:bg-white/50
                         transition-all duration-200"
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-gray-500">{card.label}</p>
                  <p className="text-2xl font-bold text-gray-800 mt-0.5">{card.value}</p>
                  <p className={`text-xs mt-1 ${card.subColor}`}>{card.sub}</p>
                </div>
                {card.icon}
              </div>
            </motion.div>
          ))}
        </div>

        {/* Glass Tabs */}
        <div className="rounded-xl bg-white/40 backdrop-blur-sm border border-white/30 p-1 flex gap-1 mb-5 w-fit">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === tab.id
                  ? "bg-gradient-to-r from-emerald-500 to-green-500 text-white shadow-sm"
                  : "text-gray-600 hover:bg-white/50"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === "sales" && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl backdrop-blur-lg bg-white/40 border border-white/30 shadow-md p-5"
          >
            <h3 className="text-base font-semibold text-gray-800 mb-4">Weekly Sales Performance</h3>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={salesData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(value) => [formatCurrency(value as number), 'Sales']} />
                  <Bar dataKey="sales" fill="url(#barGradient)" radius={[4, 4, 0, 0]} />
                  <defs>
                    <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" />
                      <stop offset="100%" stopColor="#22c55e" />
                    </linearGradient>
                  </defs>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </motion.div>
        )}

        {activeTab === "items" && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl backdrop-blur-lg bg-white/40 border border-white/30 shadow-md p-5"
          >
            <h3 className="text-base font-semibold text-gray-800 mb-4">Top Selling Items</h3>
            <div className="space-y-3">
              {topItems.map((item, index) => (
                <div key={item.name} className="flex items-center justify-between p-3 rounded-xl bg-white/50 border border-white/40">
                  <div className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-emerald-500 to-green-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
                      {index + 1}
                    </div>
                    <div>
                      <p className="font-medium text-sm text-gray-800">{item.name}</p>
                      <p className="text-xs text-gray-500">{item.sold} units sold</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-sm text-gray-800">{formatCurrency(item.revenue)}</p>
                    <span className="text-[11px] font-medium bg-emerald-100/80 text-emerald-700 px-2 py-0.5 rounded-lg">
                      {((item.revenue / (salesReport?.totalSales || 1)) * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>
              ))}
              {topItems.length === 0 && (
                <p className="text-center text-gray-400 py-8">No data available</p>
              )}
            </div>
          </motion.div>
        )}

        {activeTab === "orders" && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl backdrop-blur-lg bg-white/40 border border-white/30 shadow-md p-5"
          >
            <h3 className="text-base font-semibold text-gray-800 mb-4">Recent Orders</h3>
            <div className="space-y-3">
              {salesReport?.orders?.slice(0, 10).map((order: any) => (
                <div key={order.id} className="flex items-center justify-between p-3 rounded-xl bg-white/50 border border-white/40">
                  <div>
                    <p className="font-medium text-sm text-gray-800">{order.orderNumber}</p>
                    <p className="text-xs text-gray-500">{order.customerName || 'Walk-in'} · {order.orderType}</p>
                    <p className="text-xs text-gray-400">{new Date(order.createdAt).toLocaleString()}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-sm text-gray-800">{formatCurrency(parseFloat(order.totalAmount))}</p>
                    <span className="text-[11px] font-medium bg-white/70 border border-white/50 text-gray-600 px-2 py-0.5 rounded-lg">
                      {order.paymentMethod}
                    </span>
                  </div>
                </div>
              ))}
              {(!salesReport?.orders || salesReport.orders.length === 0) && (
                <p className="text-center text-gray-400 py-8">No orders yet</p>
              )}
            </div>
          </motion.div>
        )}

        {activeTab === "payments" && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-5"
          >
            {/* Payment Mode Breakdown */}
            <div className="rounded-2xl backdrop-blur-lg bg-white/40 border border-white/30 shadow-md p-5">
              <h3 className="text-base font-semibold text-gray-800 mb-4">Today's Payment Summary</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-5">
                {[
                  { key: "cash",   label: "Cash",   icon: <Banknote className="w-5 h-5" />,    color: "from-emerald-500 to-green-500",  bg: "bg-emerald-50/60",  text: "text-emerald-700" },
                  { key: "card",   label: "Card",   icon: <CreditCard className="w-5 h-5" />,  color: "from-blue-500 to-cyan-500",      bg: "bg-blue-50/60",     text: "text-blue-700" },
                  { key: "upi",    label: "UPI",    icon: <Smartphone className="w-5 h-5" />,  color: "from-purple-500 to-violet-500",  bg: "bg-purple-50/60",   text: "text-purple-700" },
                  { key: "online", label: "Online", icon: <Wifi className="w-5 h-5" />,        color: "from-orange-500 to-amber-500",   bg: "bg-orange-50/60",   text: "text-orange-700" },
                  { key: "other",  label: "Other",  icon: <DollarSign className="w-5 h-5" />,  color: "from-gray-500 to-slate-500",     bg: "bg-gray-50/60",     text: "text-gray-700" },
                ].map(({ key, label, icon, color, bg, text }) => {
                  const d = paymentSummary?.breakdown?.[key] || { count: 0, amount: 0 };
                  return (
                    <div key={key} className={`rounded-xl ${bg} border border-white/50 p-4`}>
                      <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${color} flex items-center justify-center text-white mb-3`}>
                        {icon}
                      </div>
                      <p className="text-xs text-gray-500 mb-0.5">{label}</p>
                      <p className={`text-lg font-bold ${text}`}>{formatCurrency(d.amount)}</p>
                      <p className="text-xs text-gray-400">{d.count} order{d.count !== 1 ? "s" : ""}</p>
                    </div>
                  );
                })}
              </div>
              {/* Totals row */}
              <div className="flex flex-wrap gap-3 pt-4 border-t border-white/40">
                <div className="flex-1 min-w-[140px] rounded-xl bg-emerald-50/60 border border-emerald-200/40 p-3">
                  <p className="text-xs text-gray-500">Total Collected</p>
                  <p className="text-xl font-bold text-emerald-700">{formatCurrency(paymentSummary?.totalPaid || 0)}</p>
                </div>
                <div className="flex-1 min-w-[140px] rounded-xl bg-red-50/60 border border-red-200/40 p-3">
                  <p className="text-xs text-gray-500">Total Due</p>
                  <p className="text-xl font-bold text-red-600">{formatCurrency(paymentSummary?.totalDue || 0)}</p>
                  <p className="text-xs text-red-400">{paymentSummary?.dueCount || 0} unpaid order{paymentSummary?.dueCount !== 1 ? "s" : ""}</p>
                </div>
              </div>
            </div>

            {/* Due Orders List */}
            {(paymentSummary?.dueOrders?.length > 0) && (
              <div className="rounded-2xl backdrop-blur-lg bg-white/40 border border-white/30 shadow-md p-5">
                <div className="flex items-center gap-2 mb-4">
                  <AlertCircle className="w-5 h-5 text-red-500" />
                  <h3 className="text-base font-semibold text-gray-800">Unpaid / Due Orders</h3>
                  <span className="ml-auto text-xs font-semibold bg-red-100 text-red-600 px-2 py-0.5 rounded-full">
                    {paymentSummary.dueOrders.length} pending
                  </span>
                </div>
                <div className="space-y-2">
                  {paymentSummary.dueOrders.map((order: any) => (
                    <div key={order.id} className="flex items-center justify-between p-3 rounded-xl bg-red-50/50 border border-red-200/40">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center">
                          <Clock className="w-4 h-4 text-red-500" />
                        </div>
                        <div>
                          <p className="font-medium text-sm text-gray-800">
                            {order.tableNumber ? `Table ${order.tableNumber}` : order.orderNumber}
                          </p>
                          <p className="text-xs text-gray-500">
                            {order.customerName || "Walk-in"} · {order.orderType}
                          </p>
                          <p className="text-xs text-gray-400">{new Date(order.createdAt).toLocaleString()}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-sm text-red-600">{formatCurrency(parseFloat(order.totalAmount))}</p>
                        <span className="text-[11px] font-medium bg-red-100 text-red-600 px-2 py-0.5 rounded-lg">Due</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {(paymentSummary?.dueCount === 0) && (
              <div className="rounded-2xl backdrop-blur-lg bg-white/40 border border-white/30 shadow-md p-8 text-center">
                <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-3">
                  <DollarSign className="w-6 h-6 text-emerald-600" />
                </div>
                <p className="text-gray-600 font-medium">No pending payments</p>
                <p className="text-sm text-gray-400">All orders have been settled</p>
              </div>
            )}
          </motion.div>
        )}
      </main>
    </div>
  );
}
