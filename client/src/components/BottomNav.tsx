/**
 * BottomNav.tsx — Mobile bottom navigation bar
 * Visible only on screens < md (768px).
 */

import { useLocation } from "wouter";
import { LayoutGrid, ChefHat, Users, Settings } from "lucide-react";

const NAV_ITEMS = [
  { href: "/tables",    icon: LayoutGrid, label: "Orders"   },
  { href: "/kitchen",   icon: ChefHat,    label: "Kitchen"  },
  { href: "/customers", icon: Users,      label: "Customers"},
  { href: "/settings",  icon: Settings,   label: "Settings" },
] as const;

export function BottomNav() {
  const [location, navigate] = useLocation();

  return (
    <nav className="md:hidden shrink-0 safe-bottom"
      style={{
        background: "rgba(255,255,255,0.82)",
        backdropFilter: "blur(22px) saturate(1.8)",
        WebkitBackdropFilter: "blur(22px) saturate(1.8)",
        borderTop: "1px solid rgba(255,255,255,0.65)",
        boxShadow: "0 -4px 24px rgba(0,0,0,0.06), 0 -1px 0 rgba(255,255,255,0.9) inset",
      }}
    >
      <div className="flex items-center h-[56px]">
        {NAV_ITEMS.map(item => {
          const Icon     = item.icon;
          const isActive = location === item.href || location.startsWith(item.href + "/");

          return (
            <button
              key={item.href}
              onClick={() => navigate(item.href)}
              className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2 touch-manipulation"
            >
              <Icon className={`w-5 h-5 transition-colors ${isActive ? "text-emerald-600" : "text-gray-400"}`} />
              <span className={`text-[9px] font-semibold leading-none ${isActive ? "text-emerald-600" : "text-gray-400"}`}>
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
