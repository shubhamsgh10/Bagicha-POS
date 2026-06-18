import { apiUrl } from '@/lib/api';
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { BagichaLogo } from "./BagichaLogo";
import { RoleSwitcher } from "./RoleSwitcher";
import { useActiveRoleContext } from "@/context/ActiveRoleContext";
import {
  LayoutGrid, History, UtensilsCrossed, Package,
  BarChart3, Activity, Monitor, User, Users,
  Settings, LogOut, ClipboardList, Menu, X, CreditCard, UserCheck, CalendarClock,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { toPosRole } from "@/hooks/useRole";
import { useAllowedPages } from "@/hooks/useAllowedPages";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface NavItem {
  label: string;
  href: string;
  icon: any;
  roles?: string[];
  /** Visible to everyone regardless of role / allowed-pages config (e.g. self-service). */
  alwaysVisible?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { label: "Tables",      href: "/tables",        icon: LayoutGrid },
  { label: "Orders",      href: "/orders",         icon: History },
  { label: "Billing",     href: "/billing",        icon: CreditCard },
  { label: "My Attendance", href: "/my-attendance", icon: CalendarClock, alwaysVisible: true },
  { label: "Staff",       href: "/staff",          icon: UserCheck,        roles: ["admin", "manager"] },
  { label: "KOT",         href: "/kot",            icon: ClipboardList },
  { label: "Menu",        href: "/menu",           icon: UtensilsCrossed,  roles: ["admin", "manager"] },
  { label: "Inventory",   href: "/inventory",      icon: Package,          roles: ["admin", "manager"] },
  { label: "Live Tables", href: "/live-tables",    icon: Monitor,          roles: ["admin", "manager"] },
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

  const { data: settings } = useQuery<any>({
    queryKey: ["/api/settings"],
    queryFn: async () => {
      const r = await fetch(apiUrl("/api/settings"), { credentials: "include" });
      if (!r.ok) return null;
      return r.json();
    },
    staleTime: 30000,
  });

  const allowedPages = useAllowedPages(); // per-person set for staff tier, null for admin/manager
  const visibleNav = NAV_ITEMS.filter(item => {
    if (item.alwaysVisible) return true; // self-service pages — never hidden by role config
    const posRole = toPosRole(activeRole);
    // Staff tier: per-person page access (resolved per-person → role default).
    if (posRole === "staff") {
      return allowedPages ? allowedPages.has(item.href) : false;
    }
    // Manager: dynamic settings take full ownership when configured — override static item.roles
    if (posRole === "manager" && settings?.managerAllowedPages != null) {
      return (settings.managerAllowedPages as string[]).includes(item.href);
    }
    // Fallback: static role-based filter
    if (item.roles && !item.roles.includes(activeRole)) return false;
    return true;
  });

  const handleLogout = async () => {
    try {
      await logout();
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
          background: "var(--paper-0)",
          borderBottom: "1px solid var(--line)",
          boxShadow: "0 2px 20px rgba(20,34,27,0.05)",
        }}
      >

        {/* Hamburger — mobile only */}
        <button
          onClick={() => setSidebarOpen(true)}
          className="md:hidden p-2 rounded-lg text-[var(--text-2)] hover:bg-[var(--paper-100)] hover:text-[var(--text-strong)] transition-colors shrink-0"
          aria-label="Open menu"
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* Logo */}
        <div className="flex items-center gap-2 shrink-0">
          <BagichaLogo size="sm" />
        </div>

        <div className="w-px h-7 bg-[var(--line)] mx-1 shrink-0 hidden md:block" />

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
                    ? "bg-[var(--green-800)] text-[var(--text-on-green)] shadow-sm"
                    : "text-[var(--text-2)] hover:bg-[var(--paper-100)] hover:text-[var(--text-strong)]"}
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

        <div className="w-px h-7 bg-[var(--line)] mx-1 shrink-0 hidden md:block" />

        {/* User info + logout — desktop */}
        <div className="hidden md:flex items-center gap-1 shrink-0">
          <div className="flex flex-col items-end mr-1">
            <span className="text-xs font-semibold text-[var(--text-strong)] leading-none">
              {user?.username ?? "—"}
            </span>
            <span className="text-[10px] text-[var(--text-3)] capitalize mt-0.5">
              {activeRole}
            </span>
          </div>
          <button
            onClick={handleLogout}
            title="Logout"
            className="flex flex-col items-center justify-center gap-0.5 px-2.5 py-1.5 rounded-lg text-[var(--text-2)] hover:bg-[var(--danger-bg)] hover:text-[var(--danger)] transition-all duration-150"
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
              background: "var(--paper-0)",
              borderRight: "1px solid var(--line)",
              boxShadow: "4px 0 32px rgba(20,34,27,0.12)",
            }}
          >

            {/* Drawer header */}
            <div className="flex items-center justify-between px-4 py-4 border-b border-[var(--line)]">
              <div>
                <p className="text-sm font-bold text-[var(--text-strong)]">{user?.username}</p>
                <p className="text-xs text-[var(--text-3)] capitalize">{activeRole}</p>
              </div>
              <button
                onClick={() => setSidebarOpen(false)}
                className="p-2 rounded-lg hover:bg-[var(--paper-100)] text-[var(--text-3)]"
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
                          ? "bg-[var(--green-50)] text-[var(--green-800)]"
                          : "text-[var(--text-2)] hover:bg-[var(--paper-50)] hover:text-[var(--text-strong)]"
                      }`}
                    >
                      <item.icon className="w-5 h-5" style={{ color: active ? "var(--green-700)" : "var(--text-3)" }} />
                      <span className="text-sm font-semibold">{item.label}</span>
                      {active && (
                        <span className="ml-auto w-1.5 h-1.5 rounded-full bg-[var(--green-500)]" />
                      )}
                    </div>
                  </Link>
                );
              })}
            </nav>

            {/* Logout */}
            <div className="shrink-0 px-3 py-4 border-t border-[var(--line)]">
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-[var(--danger)] hover:bg-[var(--danger-bg)] transition-colors"
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
