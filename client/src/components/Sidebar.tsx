import { Link, useLocation } from "wouter";
import { BagichaLogo } from "./BagichaLogo";
import {
  LayoutDashboard,
  Package,
  FileText,
  CreditCard,
  BarChart3,
  User,
  LogOut,
  Settings,
  MonitorSmartphone,
  History,
  ChefHat,
  UtensilsCrossed,
  LayoutGrid,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";

interface NavItem {
  name: string;
  href: string;
  icon: any;
  roles?: string[];
}

const navigation: NavItem[] = [
  { name: "Dashboard",  href: "/",         icon: LayoutDashboard },
  { name: "POS",        href: "/pos",       icon: MonitorSmartphone, roles: ["admin", "manager", "cashier", "staff"] },
  { name: "Tables",     href: "/tables",    icon: LayoutGrid,        roles: ["admin", "manager", "cashier", "staff"] },
  { name: "Orders",     href: "/orders",    icon: History,           roles: ["admin", "manager", "cashier", "staff"] },
  { name: "Menu",       href: "/menu",      icon: UtensilsCrossed,   roles: ["admin", "manager"] },
  { name: "Inventory",  href: "/inventory", icon: Package,           roles: ["admin", "manager"] },
  { name: "KOT",        href: "/kot",       icon: ChefHat,           roles: ["admin", "manager", "kitchen", "staff"] },
  { name: "Billing",    href: "/billing",   icon: CreditCard,        roles: ["admin", "manager", "cashier", "staff"] },
  { name: "Reports",    href: "/reports",   icon: BarChart3,         roles: ["admin", "manager"] },
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

  const role = user?.role ?? "staff";
  const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);

  const visibleNav = navigation.filter((item) => {
    if (!item.roles) return true;
    return item.roles.includes(role);
  });

  const isActive = (href: string) => {
    if (href === "/") return location === "/";
    return location === href;
  };

  return (
    <div className="w-56 bg-card shadow-lg flex flex-col sticky top-0 z-10 shrink-0 h-screen border-r border-border">
      {/* Logo */}
      <div className="p-4 border-b border-border">
        <BagichaLogo />
        <p className="text-xs text-muted-foreground mt-0.5">Restaurant POS</p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
        {visibleNav.map((item) => {
          const active = isActive(item.href);
          return (
            <Link key={item.name} href={item.href}>
              <div
                className={`flex items-center space-x-3 px-3 py-2.5 rounded-lg transition-colors cursor-pointer ${
                  active
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted text-foreground"
                }`}
              >
                <item.icon className="w-4 h-4 shrink-0" />
                <span className="text-sm font-medium">{item.name}</span>
              </div>
            </Link>
          );
        })}
      </nav>

      {/* Bottom section */}
      <div className="p-2 border-t border-border space-y-0.5">
        {/* User info */}
        <div className="flex items-center space-x-2.5 px-2 py-2 mb-0.5">
          <div className="w-7 h-7 bg-primary rounded-full flex items-center justify-center shrink-0">
            <User className="w-3.5 h-3.5 text-primary-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <p className="text-sm font-medium text-foreground truncate">{user?.username ?? "—"}</p>
              <p className="text-xs text-muted-foreground">{roleLabel}</p>
            </div>
          </div>
        </div>

        {/* Admin Panel — admin only */}
        {role === "admin" && (
          <Link href="/admin">
            <div
              className={`flex items-center space-x-2 px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer ${
                isActive("/admin")
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <User className="w-4 h-4 shrink-0" />
              <span>Admin Panel</span>
            </div>
          </Link>
        )}

        {/* Settings — admin only */}
        {role === "admin" && (
          <Link href="/settings">
            <div
              className={`flex items-center space-x-2 px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer ${
                isActive("/settings")
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <Settings className="w-4 h-4 shrink-0" />
              <span>Settings</span>
            </div>
          </Link>
        )}

        {/* Logout */}
        <button
          onClick={handleLogout}
          className="flex items-center space-x-2 w-full px-3 py-2 rounded-lg text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <LogOut className="w-4 h-4 shrink-0" />
          <span>Sign out</span>
        </button>
      </div>
    </div>
  );
}
