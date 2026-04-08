import { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutGrid, History, UtensilsCrossed, Package,
  BarChart3, Activity, Monitor, User, Users,
  Settings, LogOut, ClipboardList, MoreHorizontal, X,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useActiveRoleContext } from "@/context/ActiveRoleContext";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const NAV_ITEMS = [
  { label: "Tables",      href: "/tables",        icon: LayoutGrid   },
  { label: "Orders",      href: "/orders",         icon: History      },
  { label: "KOT",         href: "/kot",            icon: ClipboardList },
  { label: "Live",        href: "/live-tables",    icon: Monitor,     roles: ["admin", "manager"] },
  { label: "Customers",   href: "/customers",      icon: Users,       roles: ["admin", "manager"] },
  { label: "Menu",        href: "/menu",           icon: UtensilsCrossed, roles: ["admin", "manager"] },
  { label: "Inventory",   href: "/inventory",      icon: Package,     roles: ["admin", "manager"] },
  { label: "Live View",   href: "/live-analytics", icon: Activity,    roles: ["admin"] },
  { label: "Reports",     href: "/reports",        icon: BarChart3,   roles: ["admin"] },
  { label: "Admin",       href: "/admin",          icon: User,        roles: ["admin"] },
  { label: "Settings",    href: "/settings",       icon: Settings,    roles: ["admin"] },
];

export function MobileNav() {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const { activeRole } = useActiveRoleContext();
  const [showMore, setShowMore] = useState(false);

  const visible = NAV_ITEMS.filter(item =>
    !item.roles || item.roles.includes(activeRole)
  );

  // First 4 items in the bottom bar; the rest go into "More"
  const primary  = visible.slice(0, 4);
  const overflow = visible.slice(4);

  const handleLogout = async () => {
    try {
      setShowMore(false);
      await logout();
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    } catch {
      toast({ title: "Logout failed", variant: "destructive" });
    }
  };

  const isActive = (href: string) =>
    location === href || (href !== "/tables" && location.startsWith(href));

  return (
    <>
      {/* ── More drawer (overlay) ───────────────────────────────────── */}
      {showMore && (
        <div className="md:hidden fixed inset-0 z-50 flex flex-col justify-end">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setShowMore(false)}
          />
          {/* Sheet */}
          <div className="relative bg-white rounded-t-3xl shadow-2xl px-4 pt-4 pb-6 z-10">
            {/* Handle */}
            <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-4" />

            <div className="flex items-center justify-between mb-3 px-1">
              <div>
                <p className="text-sm font-bold text-gray-800">{user?.username}</p>
                <p className="text-xs text-gray-400 capitalize">{activeRole}</p>
              </div>
              <button
                onClick={() => setShowMore(false)}
                className="p-2 rounded-full hover:bg-gray-100 text-gray-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-4 gap-2">
              {overflow.map(item => {
                const active = isActive(item.href);
                return (
                  <Link key={item.href} href={item.href}>
                    <div
                      onClick={() => setShowMore(false)}
                      className={`flex flex-col items-center justify-center gap-1 py-3 px-1 rounded-2xl transition-colors ${
                        active
                          ? "bg-emerald-50 text-emerald-600"
                          : "text-gray-500 hover:bg-gray-50"
                      }`}
                    >
                      <item.icon className="w-5 h-5" />
                      <span className="text-[10px] font-semibold text-center leading-tight">{item.label}</span>
                    </div>
                  </Link>
                );
              })}
              {/* Logout */}
              <button
                onClick={handleLogout}
                className="flex flex-col items-center justify-center gap-1 py-3 px-1 rounded-2xl text-red-400 hover:bg-red-50 transition-colors"
              >
                <LogOut className="w-5 h-5" />
                <span className="text-[10px] font-semibold">Logout</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Bottom nav bar ──────────────────────────────────────────── */}
      <div className="md:hidden shrink-0 bg-white border-t border-gray-100 flex items-stretch z-40 safe-bottom">
        {primary.map(item => {
          const active = isActive(item.href);
          return (
            <Link key={item.href} href={item.href} className="flex-1">
              <div className={`flex flex-col items-center justify-center gap-0.5 py-2.5 transition-colors ${
                active ? "text-emerald-600" : "text-gray-400"
              }`}>
                <item.icon className="w-5 h-5" />
                <span className="text-[9px] font-semibold">{item.label}</span>
                {active && (
                  <span className="absolute bottom-0 w-6 h-0.5 bg-emerald-500 rounded-t-full" />
                )}
              </div>
            </Link>
          );
        })}

        {/* More button */}
        <button
          onClick={() => setShowMore(true)}
          className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 transition-colors ${
            showMore ? "text-emerald-600" : "text-gray-400"
          }`}
        >
          <MoreHorizontal className="w-5 h-5" />
          <span className="text-[9px] font-semibold">More</span>
        </button>
      </div>
    </>
  );
}
