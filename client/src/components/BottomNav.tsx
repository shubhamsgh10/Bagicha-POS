import { useLocation } from "wouter";
import { LayoutGrid, History, CreditCard, Monitor } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useActiveRoleContext } from "@/context/ActiveRoleContext";
import { toPosRole } from "@/hooks/useRole";

const NAV_ITEMS = [
  { href: "/tables",      icon: LayoutGrid, label: "Tables"      },
  { href: "/orders",      icon: History,    label: "Orders"      },
  { href: "/billing",     icon: CreditCard, label: "Billing"     },
  { href: "/live-tables", icon: Monitor,    label: "Live Tables" },
] as const;

export function BottomNav() {
  const [location, navigate] = useLocation();
  const { activeRole } = useActiveRoleContext();

  const { data: settings } = useQuery<any>({
    queryKey: ["/api/settings"],
    queryFn: async () => {
      const r = await fetch("/api/settings", { credentials: "include" });
      if (!r.ok) return null;
      return r.json();
    },
    staleTime: 30_000,
  });

  const visibleItems = NAV_ITEMS.filter(item => {
    const posRole = toPosRole(activeRole);
    if (posRole === "staff" && settings?.staffAllowedPages != null) {
      return (settings.staffAllowedPages as string[]).includes(item.href);
    }
    if (posRole === "manager" && settings?.managerAllowedPages != null) {
      return (settings.managerAllowedPages as string[]).includes(item.href);
    }
    return true;
  });

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
        {visibleItems.map(item => {
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
