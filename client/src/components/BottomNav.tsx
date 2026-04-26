/**
 * BottomNav.tsx — Mobile bottom navigation bar
 * Visible only on screens < md (768px).
 */

import { useLocation } from "wouter";
import { LayoutGrid, PlusCircle, ChefHat, Users, Settings } from "lucide-react";

const NAV_ITEMS = [
  { href: "/tables",    icon: LayoutGrid, label: "Orders"   },
  { href: "/mobile-pos",icon: PlusCircle, label: "New Order", accent: true },
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
      <div className="flex items-end h-[56px] pb-1">
        {NAV_ITEMS.map(item => {
          const Icon     = item.icon;
          const isActive = location === item.href || location.startsWith(item.href + "/");
          const isAccent = "accent" in item && item.accent;

          return (
            <button
              key={item.href}
              onClick={() => navigate(item.href)}
              className="flex-1 flex flex-col items-center justify-end pb-1 touch-manipulation"
            >
              {isAccent ? (
                /* New Order — raised green circle */
                <div className="flex flex-col items-center -mt-5">
                  <div className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-transform active:scale-95 ${
                    isActive ? "bg-emerald-600" : "bg-emerald-500"
                  }`}
                    style={{ boxShadow: "0 6px 20px rgba(16,185,129,0.42), 0 2px 8px rgba(0,0,0,0.10)" }}
                  >
                    <Icon className="w-6 h-6 text-white" />
                  </div>
                  <span className={`text-[9px] font-semibold mt-0.5 ${
                    isActive ? "text-emerald-600" : "text-gray-500"
                  }`}>
                    {item.label}
                  </span>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-0.5">
                  <Icon className={`w-5 h-5 transition-colors ${
                    isActive ? "text-emerald-600" : "text-gray-400"
                  }`} />
                  <span className={`text-[9px] font-semibold leading-none ${
                    isActive ? "text-emerald-600" : "text-gray-400"
                  }`}>
                    {item.label}
                  </span>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
