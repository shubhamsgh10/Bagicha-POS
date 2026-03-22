import { Link, useLocation } from "wouter";
import { BagichaLogo } from "./BagichaLogo";
import {
  LayoutDashboard,
  ShoppingCart,
  Menu,
  Package,
  FileText,
  CreditCard,
  BarChart3,
  User,
  LogOut,
  Settings,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";

const navigation = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Orders", href: "/orders", icon: ShoppingCart },
  { name: "Menu", href: "/menu", icon: Menu },
  { name: "Inventory", href: "/inventory", icon: Package },
  { name: "KOT", href: "/kot", icon: FileText },
  { name: "Billing", href: "/billing", icon: CreditCard },
  { name: "Reports", href: "/reports", icon: BarChart3 },
];

export function Sidebar() {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const { toast } = useToast();

  const handleLogout = async () => {
    try {
      await logout();
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    } catch {
      toast({ title: "Logout failed", variant: "destructive" });
    }
  };

  const roleLabel = user?.role
    ? user.role.charAt(0).toUpperCase() + user.role.slice(1)
    : "";

  return (
    <div className="w-64 bg-card shadow-lg flex flex-col sticky top-0 z-10">
      <div className="p-6 border-b border-border">
        <BagichaLogo />
        <p className="text-xs text-muted-foreground mt-1">Restaurant POS</p>
      </div>

      <nav className="flex-1 p-4 space-y-2">
        {navigation.map((item) => {
          const isActive = location === item.href;
          return (
            <Link key={item.name} href={item.href}>
              <div className={`flex items-center space-x-3 p-3 rounded-lg transition-colors cursor-pointer ${
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'hover:bg-muted text-foreground'
              }`}>
                <item.icon className="w-5 h-5" />
                <span>{item.name}</span>
              </div>
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-border space-y-2">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 bg-primary rounded-full flex items-center justify-center">
            <User className="w-4 h-4 text-primary-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{user?.username ?? "—"}</p>
            <p className="text-xs text-muted-foreground">{roleLabel}</p>
          </div>
        </div>
        <Link href="/admin">
          <div className={`flex items-center space-x-2 w-full p-2 rounded-lg text-sm transition-colors cursor-pointer ${location === "/admin" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>
            <Settings className="w-4 h-4" />
            <span>Admin Panel</span>
          </div>
        </Link>
        <button
          onClick={handleLogout}
          className="flex items-center space-x-2 w-full p-2 rounded-lg text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <LogOut className="w-4 h-4" />
          <span>Sign out</span>
        </button>
      </div>
    </div>
  );
}
