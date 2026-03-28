import { Link, useLocation } from "wouter";
import { BagichaLogo } from "./BagichaLogo";
import {
  LayoutGrid,
  History,
  UtensilsCrossed,
  Package,
  BarChart3,
  Activity,
  User,
  Settings,
  LogOut,
  ClipboardList,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface NavItem {
  label: string;
  href: string;
  icon: any;
  roles?: string[];
}

const NAV_ITEMS: NavItem[] = [
  { label: "Tables",    href: "/tables",        icon: LayoutGrid },
  { label: "Orders",    href: "/orders",         icon: History },
  { label: "KOT",       href: "/kot",            icon: ClipboardList },
  { label: "Menu",      href: "/menu",           icon: UtensilsCrossed, roles: ["admin", "manager"] },
  { label: "Inventory", href: "/inventory",      icon: Package,         roles: ["admin", "manager"] },
  { label: "Reports",   href: "/reports",        icon: BarChart3,       roles: ["admin", "manager"] },
  { label: "Live View", href: "/live-analytics", icon: Activity },
  { label: "Admin",     href: "/admin",          icon: User,            roles: ["admin"] },
  { label: "Settings",  href: "/settings",       icon: Settings,        roles: ["admin"] },
];

export function TopNav() {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const { toast } = useToast();

  const role = user?.role ?? "staff";

  const visibleNav = NAV_ITEMS.filter(item =>
    !item.roles || item.roles.includes(role)
  );

  const handleLogout = async () => {
    try {
      await logout();
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    } catch {
      toast({ title: "Logout failed", variant: "destructive" });
    }
  };

  return (
    <header className="shrink-0 h-14 bg-white/80 backdrop-blur-xl border-b border-black/5 flex items-center px-3 gap-2 shadow-sm z-50">
      {/* Logo */}
      <div className="flex items-center gap-2 shrink-0">
        <BagichaLogo size="sm" />
      </div>

      <div className="w-px h-7 bg-gray-200 mx-1 shrink-0" />

      {/* Navigation icons */}
      <nav className="flex items-center gap-0.5 flex-1 overflow-x-auto scrollbar-hide">
        {visibleNav.map(item => {
          const active =
            location === item.href ||
            (item.href !== "/tables" && location.startsWith(item.href));
          return (
            <Link key={item.href} href={item.href}>
              <div
                className={`
                  flex flex-col items-center justify-center gap-0.5 px-3 py-1.5
                  rounded-lg cursor-pointer transition-all duration-150 select-none min-w-[56px]
                  ${active
                    ? "bg-gradient-to-br from-emerald-500 to-green-500 text-white shadow-sm"
                    : "text-gray-500 hover:bg-gray-100 hover:text-gray-800"}
                `}
              >
                <item.icon className="w-[18px] h-[18px]" />
                <span className="text-[9px] font-semibold leading-none whitespace-nowrap">
                  {item.label}
                </span>
              </div>
            </Link>
          );
        })}
      </nav>

      {/* Right: user info + logout */}
      <div className="flex items-center gap-1 shrink-0 pl-2 border-l border-gray-200">
        <div className="hidden sm:flex flex-col items-end mr-1">
          <span className="text-xs font-semibold text-gray-800 leading-none">
            {user?.username ?? "—"}
          </span>
          <span className="text-[10px] text-gray-400 capitalize mt-0.5">
            {role}
          </span>
        </div>
        <button
          onClick={handleLogout}
          title="Logout"
          className="flex flex-col items-center justify-center gap-0.5 px-2.5 py-1.5 rounded-lg text-gray-500 hover:bg-red-50 hover:text-red-600 transition-all duration-150"
        >
          <LogOut className="w-[18px] h-[18px]" />
          <span className="text-[9px] font-semibold leading-none">Logout</span>
        </button>
      </div>
    </header>
  );
}
