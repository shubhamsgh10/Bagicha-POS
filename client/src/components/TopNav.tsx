import { useState } from "react";
import { Link, useLocation } from "wouter";
import { BagichaLogo } from "./BagichaLogo";
import { RoleSwitcher } from "./RoleSwitcher";
import { useActiveRoleContext } from "@/context/ActiveRoleContext";
import {
  LayoutGrid, History, UtensilsCrossed, Package,
  BarChart3, Activity, Monitor, User, Users,
  Settings, LogOut, ClipboardList, Menu, X, ChefHat,
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
  { label: "Tables",      href: "/tables",        icon: LayoutGrid },
  { label: "Orders",      href: "/orders",         icon: History },
  { label: "KOT",         href: "/kot",            icon: ClipboardList },
  { label: "Menu",        href: "/menu",           icon: UtensilsCrossed,  roles: ["admin", "manager"] },
  { label: "Inventory",   href: "/inventory",      icon: Package,          roles: ["admin", "manager"] },
  { label: "Live Tables", href: "/live-tables",    icon: Monitor,          roles: ["admin", "manager"] },
  { label: "Kitchen",     href: "/kitchen",        icon: ChefHat,          roles: ["admin", "manager"] },
  { label: "Customers",   href: "/customers",      icon: Users,            roles: ["admin", "manager"] },
  { label: "Live View",   href: "/live-analytics", icon: Activity,         roles: ["admin"] },
  { label: "Reports",     href: "/reports",        icon: BarChart3,        roles: ["admin"] },
  { label: "Admin",       href: "/admin",          icon: User,             roles: ["admin"] },
  { label: "Settings",    href: "/settings",       icon: Settings,         roles: ["admin"] },
];

export function TopNav() {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const { activeRole, loginRole, secondsLeft, isElevated, elevateRole, revertRole } = useActiveRoleContext();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const visibleNav = NAV_ITEMS.filter(item =>
    !item.roles || item.roles.includes(activeRole)
  );

  const handleLogout = async () => {
    try {
      await logout();
      setSidebarOpen(false);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    } catch {
      toast({ title: "Logout failed", variant: "destructive" });
    }
  };

  const isActive = (href: string) =>
    location === href || (href !== "/tables" && location.startsWith(href));

  return (
    <>
      {/* ── Top bar (always visible) ──────────────────────────────────────── */}
      <header className="shrink-0 h-14 flex items-center px-3 gap-2 z-50"
        style={{
          background: "rgba(255,255,255,0.78)",
          backdropFilter: "blur(22px) saturate(1.9)",
          WebkitBackdropFilter: "blur(22px) saturate(1.9)",
          borderBottom: "1px solid rgba(255,255,255,0.65)",
          boxShadow: "0 1px 0 rgba(255,255,255,0.95) inset, 0 2px 20px rgba(0,0,0,0.06)",
        }}
      >

        {/* Hamburger — mobile only */}
        <button
          onClick={() => setSidebarOpen(true)}
          className="md:hidden p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-800 transition-colors shrink-0"
          aria-label="Open menu"
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* Logo */}
        <div className="flex items-center gap-2 shrink-0">
          <BagichaLogo size="sm" />
        </div>

        <div className="w-px h-7 bg-gray-200 mx-1 shrink-0 hidden md:block" />

        {/* Navigation icons — desktop only */}
        <nav className="hidden md:flex items-center gap-0.5 flex-1 overflow-x-auto scrollbar-hide">
          {visibleNav.map(item => {
            const active = isActive(item.href);
            return (
              <Link key={item.href} href={item.href}>
                <div className={`
                  flex flex-col items-center justify-center gap-0.5 px-3 py-1.5
                  rounded-lg cursor-pointer transition-all duration-150 select-none min-w-[56px]
                  ${active
                    ? "bg-gradient-to-br from-emerald-500 to-green-500 text-white shadow-sm"
                    : "text-gray-500 hover:bg-gray-100 hover:text-gray-800"}
                `}>
                  <item.icon className="w-[18px] h-[18px]" />
                  <span className="text-[9px] font-semibold leading-none whitespace-nowrap">
                    {item.label}
                  </span>
                </div>
              </Link>
            );
          })}
        </nav>

        {/* Spacer on mobile */}
        <div className="flex-1 md:hidden" />

        {/* Role Switcher */}
        <RoleSwitcher
          activeRole={activeRole}
          loginRole={loginRole}
          secondsLeft={secondsLeft}
          isElevated={isElevated}
          onElevate={elevateRole}
          onRevert={revertRole}
        />

        <div className="w-px h-7 bg-gray-200 mx-1 shrink-0 hidden md:block" />

        {/* User info + logout — desktop */}
        <div className="hidden md:flex items-center gap-1 shrink-0">
          <div className="flex flex-col items-end mr-1">
            <span className="text-xs font-semibold text-gray-800 leading-none">
              {user?.username ?? "—"}
            </span>
            <span className="text-[10px] text-gray-400 capitalize mt-0.5">
              {activeRole}
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

      {/* ── Mobile sidebar drawer ─────────────────────────────────────────── */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-[100] md:hidden flex">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setSidebarOpen(false)}
          />

          {/* Drawer panel */}
          <div className="relative w-72 max-w-[85vw] h-full flex flex-col"
            style={{
              background: "rgba(255,255,255,0.88)",
              backdropFilter: "blur(24px) saturate(1.8)",
              WebkitBackdropFilter: "blur(24px) saturate(1.8)",
              borderRight: "1px solid rgba(255,255,255,0.65)",
              boxShadow: "4px 0 32px rgba(0,0,0,0.10)",
            }}
          >

            {/* Drawer header */}
            <div className="flex items-center justify-between px-4 py-4 border-b">
              <div>
                <p className="text-sm font-bold text-gray-800">{user?.username}</p>
                <p className="text-xs text-gray-400 capitalize">{activeRole}</p>
              </div>
              <button
                onClick={() => setSidebarOpen(false)}
                className="p-2 rounded-lg hover:bg-gray-100 text-gray-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Nav items */}
            <nav className="flex-1 overflow-y-auto py-3 px-3 space-y-0.5">
              {visibleNav.map(item => {
                const active = isActive(item.href);
                return (
                  <Link key={item.href} href={item.href}>
                    <div
                      onClick={() => setSidebarOpen(false)}
                      className={`flex items-center gap-3 px-3 py-3 rounded-xl transition-colors cursor-pointer ${
                        active
                          ? "bg-emerald-50 text-emerald-700"
                          : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                      }`}
                    >
                      <item.icon className={`w-5 h-5 ${active ? "text-emerald-600" : "text-gray-400"}`} />
                      <span className="text-sm font-semibold">{item.label}</span>
                      {active && (
                        <span className="ml-auto w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      )}
                    </div>
                  </Link>
                );
              })}
            </nav>

            {/* Logout */}
            <div className="shrink-0 px-3 py-4 border-t">
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-red-500 hover:bg-red-50 transition-colors"
              >
                <LogOut className="w-5 h-5" />
                <span className="text-sm font-semibold">Logout</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
