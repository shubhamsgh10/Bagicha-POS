import { useState } from "react";
import { ChevronDown, Lock, ShieldCheck, User, UserCog, ChefHat, CreditCard } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { PinGuard } from "./PinGuard";
import { UserRole, ROLE_LEVEL } from "@/hooks/useRole";

interface RoleSwitcherProps {
  activeRole: UserRole;
  loginRole: UserRole;
  secondsLeft: number;
  isElevated: boolean;
  onElevate: (role: UserRole) => void;
  onRevert: () => void;
}

const ROLE_META: Record<string, { label: string; color: string; bg: string; border: string }> = {
  staff:   { label: "Staff",   color: "text-gray-600",   bg: "bg-gray-100",    border: "border-gray-300"  },
  kitchen: { label: "Kitchen", color: "text-orange-700", bg: "bg-orange-50",   border: "border-orange-300"},
  cashier: { label: "Cashier", color: "text-purple-700", bg: "bg-purple-50",   border: "border-purple-300"},
  manager: { label: "Manager", color: "text-blue-700",   bg: "bg-blue-50",     border: "border-blue-300"  },
  admin:   { label: "Admin",   color: "text-green-700",  bg: "bg-green-50",    border: "border-green-400" },
};

const ROLE_ICONS: Record<string, React.ReactNode> = {
  staff:   <User className="w-3 h-3" />,
  kitchen: <ChefHat className="w-3 h-3" />,
  cashier: <CreditCard className="w-3 h-3" />,
  manager: <UserCog className="w-3 h-3" />,
  admin:   <ShieldCheck className="w-3 h-3" />,
};

/** Ordered display sequence — only manager and admin are system roles */
const ROLE_ORDER: UserRole[] = ["manager", "admin"];

function fmtTime(secs: number) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function RoleSwitcher({ activeRole, loginRole, secondsLeft, isElevated, onElevate, onRevert }: RoleSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [pinTarget, setPinTarget] = useState<UserRole | null>(null);

  // Fetch which roles have PINs configured in the admin panel
  const { data: switchableData } = useQuery({
    queryKey: ["/api/auth/switchable-roles"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/auth/switchable-roles");
      return res.json() as Promise<{ roles: string[] }>;
    },
    staleTime: 30_000,
  });

  const rolesWithPin: UserRole[] = (switchableData?.roles ?? []) as UserRole[];

  // Show: the current user's own login role (always) + any role with a PIN configured
  const visibleRoles = ROLE_ORDER.filter(
    (r) => r === loginRole || rolesWithPin.includes(r)
  );

  const meta = ROLE_META[activeRole] ?? ROLE_META.staff;

  const handleSelect = (role: UserRole) => {
    setOpen(false);
    if (role === activeRole) return;
    const targetLevel = ROLE_LEVEL[role] ?? 0;
    const currentLevel = ROLE_LEVEL[activeRole] ?? 0;
    if (targetLevel <= currentLevel) {
      onElevate(role);
      return;
    }
    setPinTarget(role);
  };

  const handlePinSuccess = () => {
    if (pinTarget) { onElevate(pinTarget); setPinTarget(null); }
  };

  // For PIN verification: pass the target role name directly so server can check the right users
  const pinRequiredRole = (pinTarget === "admin" ? "admin" : "manager") as "manager" | "admin";

  return (
    <>
      {pinTarget && (
        <PinGuard
          actionLabel={`Switch to ${ROLE_META[pinTarget]?.label ?? pinTarget} Mode`}
          requiredRole={pinRequiredRole}
          onSuccess={handlePinSuccess}
          onCancel={() => setPinTarget(null)}
        />
      )}

      <div className="flex items-center gap-1 shrink-0">
        <div className="relative">
          <button
            onClick={() => setOpen((v) => !v)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded border text-xs font-semibold transition-colors ${meta.bg} ${meta.color} ${meta.border}`}
          >
            {ROLE_ICONS[activeRole] ?? ROLE_ICONS.staff}
            {meta.label}
            <ChevronDown className="w-3 h-3 opacity-60" />
          </button>

          {open && (
            <div
              className="absolute left-0 top-full mt-1 z-50 w-40 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden"
              onMouseLeave={() => setOpen(false)}
            >
              {visibleRoles.map((role) => {
                const m = ROLE_META[role] ?? ROLE_META.staff;
                const targetLevel = ROLE_LEVEL[role] ?? 0;
                const currentLevel = ROLE_LEVEL[activeRole] ?? 0;
                const needsPin = targetLevel > currentLevel;
                const isCurrent = role === activeRole;
                const hasPin = rolesWithPin.includes(role);

                return (
                  <button
                    key={role}
                    onClick={() => handleSelect(role)}
                    disabled={needsPin && !hasPin}
                    className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 text-xs font-semibold transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed ${
                      isCurrent ? `${m.bg} ${m.color}` : "text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      {ROLE_ICONS[role] ?? ROLE_ICONS.staff}
                      {m.label}
                    </span>
                    {needsPin && !isCurrent && (
                      hasPin
                        ? <Lock className="w-2.5 h-2.5 opacity-50" />
                        : <span className="text-[9px] text-gray-400">no PIN</span>
                    )}
                    {isCurrent && <span className="w-1.5 h-1.5 rounded-full bg-current opacity-60" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {isElevated && (
          <>
            {secondsLeft > 0 && (
              <span className="text-[10px] font-mono text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
                {fmtTime(secondsLeft)}
              </span>
            )}
            <button
              onClick={onRevert}
              title="Revert to your login role"
              className="flex items-center gap-1 text-[10px] font-semibold text-gray-500 hover:text-red-500 border border-gray-200 hover:border-red-300 px-2 py-1.5 rounded transition-colors"
            >
              <Lock className="w-3 h-3" />
              Lock
            </button>
          </>
        )}
      </div>
    </>
  );
}
