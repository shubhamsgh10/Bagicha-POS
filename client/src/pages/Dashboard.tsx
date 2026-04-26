import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Header } from "@/components/Header";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import {
  IndianRupee, ShoppingBag, Clock, TrendingUp, AlertTriangle, Star, LayoutGrid,
} from "lucide-react";
import { useLocation } from "wouter";

const fmt = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0 }).format(n);

const PALETTE = ['#6366f1', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6'];

const cardAnim = {
  hidden: { opacity: 0, y: 16 },
  visible: (i: number) => ({
    opacity: 1, y: 0,
    transition: { delay: i * 0.07, duration: 0.35, ease: 'easeOut' },
  }),
};

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-xl px-3 py-2 shadow-lg text-xs">
      <p className="text-muted-foreground mb-1">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} className="font-semibold text-foreground">
          {p.name === 'total' ? fmt(p.value) : `${p.value} sold`}
        </p>
      ))}
    </div>
  );
};

export default function Dashboard() {
  const [, navigate] = useLocation();

  const { data: stats } = useQuery<any>({
    queryKey: ['/api/dashboard/stats'],
    staleTime: 0,
    refetchInterval: 5000,
  });

  const { data: salesChart = [] } = useQuery<any[]>({
    queryKey: ['/api/dashboard/sales-chart'],
    staleTime: 0,
    refetchInterval: 5000,
  });

  const { data: categorySales = [] } = useQuery<any[]>({
    queryKey: ['/api/dashboard/category-sales'],
    staleTime: 0,
    refetchInterval: 5000,
  });

  const { data: topItems = [] } = useQuery<any[]>({
    queryKey: ['/api/dashboard/top-items'],
    staleTime: 0,
    refetchInterval: 5000,
  });

  const { data: lowStockItems = [] } = useQuery<any[]>({
    queryKey: ['/api/inventory/low-stock'],
    staleTime: 0,
    refetchInterval: 10000,
  });

  const statCards = [
    {
      label: "Today's Sales",
      value: fmt(stats?.todaySales || 0),
      sub: `${stats?.todayOrders || 0} orders placed`,
      icon: IndianRupee,
      gradient: 'from-violet-500 to-purple-600',
      glassColor: 'rgba(99,102,241,0.07)',
      glowColor:  'rgba(99,102,241,0.12)',
      borderColor: 'rgba(99,102,241,0.22)',
    },
    {
      label: 'Orders Today',
      value: String(stats?.todayOrders || 0),
      sub: `Avg ${fmt(stats?.avgOrderValue || 0)} / order`,
      icon: ShoppingBag,
      gradient: 'from-blue-500 to-cyan-500',
      glassColor: 'rgba(59,130,246,0.07)',
      glowColor:  'rgba(59,130,246,0.12)',
      borderColor: 'rgba(59,130,246,0.22)',
    },
    {
      label: 'Active Orders',
      value: String(stats?.activeOrders || 0),
      sub: 'Pending / preparing',
      icon: Clock,
      gradient: 'from-amber-500 to-orange-500',
      glassColor: 'rgba(245,158,11,0.07)',
      glowColor:  'rgba(245,158,11,0.12)',
      borderColor: 'rgba(245,158,11,0.22)',
    },
    {
      label: 'Total Revenue',
      value: fmt(stats?.totalRevenue || 0),
      sub: 'All time',
      icon: TrendingUp,
      gradient: 'from-emerald-500 to-green-500',
      glassColor: 'rgba(16,185,129,0.07)',
      glowColor:  'rgba(16,185,129,0.12)',
      borderColor: 'rgba(16,185,129,0.22)',
    },
    {
      label: 'Low Stock',
      value: String(stats?.lowStockCount || 0),
      sub: stats?.lowStockCount > 0 ? 'Needs attention' : 'All good',
      icon: AlertTriangle,
      gradient: stats?.lowStockCount > 0 ? 'from-red-500 to-rose-600' : 'from-green-500 to-emerald-500',
      glassColor: stats?.lowStockCount > 0 ? 'rgba(239,68,68,0.07)'  : 'rgba(16,185,129,0.07)',
      glowColor:  stats?.lowStockCount > 0 ? 'rgba(239,68,68,0.12)'  : 'rgba(16,185,129,0.12)',
      borderColor:stats?.lowStockCount > 0 ? 'rgba(239,68,68,0.22)'  : 'rgba(16,185,129,0.22)',
    },
    {
      label: 'Top Item Today',
      value: stats?.topItem || '—',
      sub: 'Best seller',
      icon: Star,
      gradient: 'from-pink-500 to-rose-500',
      glassColor: 'rgba(236,72,153,0.07)',
      glowColor:  'rgba(236,72,153,0.12)',
      borderColor: 'rgba(236,72,153,0.22)',
    },
    {
      label: 'Inner Running',
      value: String(stats?.innerRunning || 0),
      sub: `of ${stats?.totalTables || 0} total tables`,
      icon: LayoutGrid,
      gradient: 'from-indigo-500 to-blue-500',
      glassColor: 'rgba(79,70,229,0.07)',
      glowColor:  'rgba(79,70,229,0.12)',
      borderColor: 'rgba(79,70,229,0.22)',
    },
    {
      label: 'Outer Running',
      value: String(stats?.outerRunning || 0),
      sub: `of ${stats?.totalTables || 0} total tables`,
      icon: LayoutGrid,
      gradient: 'from-teal-500 to-cyan-500',
      glassColor: 'rgba(20,184,166,0.07)',
      glowColor:  'rgba(20,184,166,0.12)',
      borderColor: 'rgba(20,184,166,0.22)',
    },
  ];

  return (
    <div className="flex-1 flex flex-col overflow-hidden" style={{ background: "transparent" }}>
      <Header
        title="Dashboard"
        description="Live analytics · refreshes every 5s"
        onNewOrder={() => navigate('/pos')}
      />

      <main className="min-h-0 flex-1 overflow-y-auto p-5 space-y-5">

        {/* ── Stat Cards ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
          {statCards.map((card, i) => (
            <motion.div
              key={card.label}
              custom={i}
              initial="hidden"
              animate="visible"
              variants={cardAnim}
              whileHover={{ scale: 1.03, transition: { duration: 0.15 } }}
              className="rounded-2xl p-4"
              style={{
                background: `rgba(255,255,255,0.50)`,
                backdropFilter: "blur(16px) saturate(1.8)",
                WebkitBackdropFilter: "blur(16px) saturate(1.8)",
                border: `1px solid ${card.borderColor}`,
                boxShadow: `0 4px 20px ${card.glowColor}, 0 1px 0 rgba(255,255,255,0.92) inset`,
              }}
            >
              <div className={`w-8 h-8 rounded-xl bg-gradient-to-br ${card.gradient} flex items-center justify-center mb-3`}
                style={{ boxShadow: `0 3px 10px ${card.glowColor}` }}>
                <card.icon className="w-4 h-4 text-white" />
              </div>
              <p className="text-[11px] font-semibold text-muted-foreground mb-0.5 uppercase tracking-wide">{card.label}</p>
              <p className="text-lg font-bold text-foreground leading-tight truncate">{card.value}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{card.sub}</p>
            </motion.div>
          ))}
        </div>

        {/* ── Row 1: Sales Line + Category Pie ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <motion.div
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.45, duration: 0.4 }}
            className="lg:col-span-2 rounded-2xl p-5 glass-card"
          >
            <p className="text-sm font-semibold mb-4">Sales — Last 7 Days</p>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={salesChart} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" strokeOpacity={0.6} />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(v) => `₹${v}`} width={55} />
                <Tooltip content={<CustomTooltip />} />
                <Line type="monotone" dataKey="total" stroke="#6366f1" strokeWidth={2.5}
                  dot={{ fill: '#6366f1', r: 3, strokeWidth: 0 }}
                  activeDot={{ r: 5, strokeWidth: 2, stroke: '#fff' }} />
              </LineChart>
            </ResponsiveContainer>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.55, duration: 0.4 }}
            className="rounded-2xl p-5 glass-card"
          >
            <p className="text-sm font-semibold mb-3">Sales by Category</p>
            {categorySales.length === 0 ? (
              <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">No sales today</div>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={150}>
                  <PieChart>
                    <Pie data={categorySales} dataKey="total" nameKey="category"
                      cx="50%" cy="50%" outerRadius={65} innerRadius={32} paddingAngle={3}>
                      {categorySales.map((_: any, idx: number) => (
                        <Cell key={idx} fill={PALETTE[idx % PALETTE.length]} />
                      ))}
                    </Pie>
                    <Tooltip content={<CustomTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-1.5 mt-3">
                  {categorySales.slice(0, 5).map((c: any, idx: number) => (
                    <div key={c.category} className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5 min-w-0">
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: PALETTE[idx % PALETTE.length] }} />
                        <span className="text-muted-foreground truncate">{c.category}</span>
                      </span>
                      <span className="font-semibold ml-2 flex-shrink-0">{fmt(c.total)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </motion.div>
        </div>

        {/* ── Row 2: Top Items Bar + Low Stock ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <motion.div
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.65, duration: 0.4 }}
            className="lg:col-span-2 rounded-2xl p-5 glass-card"
          >
            <p className="text-sm font-semibold mb-4">Top Items Today</p>
            {topItems.length === 0 ? (
              <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">No sales today</div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={topItems} margin={{ top: 4, right: 8, left: 0, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" strokeOpacity={0.6} vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false}
                    angle={-25} textAnchor="end" interval={0} />
                  <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="qty" name="qty" radius={[6, 6, 0, 0]} maxBarSize={40}>
                    {topItems.map((_: any, idx: number) => (
                      <Cell key={idx} fill={PALETTE[idx % PALETTE.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.75, duration: 0.4 }}
            className="rounded-2xl p-5 glass-card"
          >
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-semibold">Low Stock Alerts</p>
              {lowStockItems.length > 0 && (
                <span className="text-[11px] bg-red-500/10 text-red-500 px-2 py-0.5 rounded-full font-medium">
                  {lowStockItems.length} items
                </span>
              )}
            </div>
            {lowStockItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-[170px] text-center gap-2">
                <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center">
                  <span className="text-emerald-500 text-xl font-bold">✓</span>
                </div>
                <p className="text-sm text-muted-foreground">All items in stock</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                {lowStockItems.map((item: any) => (
                  <motion.div
                    key={item.id}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="flex items-center justify-between p-2.5 rounded-xl bg-red-500/5 border border-red-500/15"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-foreground truncate">{item.itemName}</p>
                      <p className="text-[11px] text-muted-foreground">Min: {item.minStock} {item.unit}</p>
                    </div>
                    <span className="text-sm font-bold text-red-500 ml-2 flex-shrink-0">
                      {item.currentStock} {item.unit}
                    </span>
                  </motion.div>
                ))}
              </div>
            )}
          </motion.div>
        </div>

      </main>
    </div>
  );
}
