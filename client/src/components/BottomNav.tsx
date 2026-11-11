import { apiUrl } from '@/lib/api';
import { useLocation } from "wouter";
import { LayoutGrid, History, CreditCard, Monitor } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useActiveRoleContext } from "@/context/ActiveRoleContext";
import { toPosRole } from "@/hooks/useRole";
import { useAllowedPages } from "@/hooks/useAllowedPages";

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
      const r = await fetch(apiUrl("/api/settings"), { credentials: "include" });
      if (!r.ok) return null;
      return r.json();
    },
    staleTime: 30_000,
  });

  const allowedPages = useAllowedPages(); // per-person set for staff tier, null for admin/manager
  const visibleItems = NAV_ITEMS.filter(item => {
    const posRole = toPosRole(activeRole);
    if (posRole === "staff") {
      return allowedPages ? allowedPages.has(item.href) : false;
    }
    if (posRole === "manager" && settings?.managerAllowedPages != null) {
      return (settings.managerAllowedPages as string[]).includes(item.href);
    }
    return true;
  });

  return (
    <nav className="md:hidden shrink-0 safe-bottom"
      style={{
        background: "var(--paper-0)",
        borderTop: "1px solid var(--line)",
        boxShadow: "0 -6px 20px rgba(20,34,27,0.05)",
      }}
    >
      <div className="flex items-stretch min-h-[60px] px-1.5 pt-1.5 pb-1">
        {visibleItems.map(item => {
          const Icon     = item.icon;
          const isActive = location === item.href || location.startsWith(item.href + "/");

          return (
            <button
              key={item.href}
              onClick={() => navigate(item.href)}
              className="flex-1 flex flex-col items-center justify-center gap-[5px] py-1.5 touch-manipulation"
              style={{ color: isActive ? "var(--green-800)" : "var(--text-3)" }}
            >
              <Icon className="w-[21px] h-[21px] transition-colors" />
              <span className="text-[10.5px] font-bold leading-none">
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
