import { useState } from "react";
import { ChevronDown, Lock, ShieldCheck, User, UserCog } from "lucide-react";
import { PinGuard } from "./PinGuard";
import { UserRole, ROLE_LEVEL } from "@/hooks/useRole";

interface RoleSwitcherProps {
  activeRole: UserRole;
  loginRole: UserRole;
  secondsLeft: number;   // 0 = no countdown
  isElevated: boolean;   // true when activeRole > loginRole
  onElevate: (role: UserRole) => void;
  onRevert: () => void;
}

const ROLE_META: Record<UserRole, { label: string; color: string; bg: string; border: string }> = {
  staff:   { label: "Staff",   color: "text-gray-600",  bg: "bg-gray-100",   border: "border-gray-300"  },
  manager: { label: "Manager", color: "text-blue-700",  bg: "bg-blue-50",    border: "border-blue-300"  },
  admin:   { label: "Admin",   color: "text-green-700", bg: "bg-green-50",   border: "border-green-400" },
};

const ROLE_ICONS: Record<UserRole, React.ReactNode> = {
  staff:   <User className="w-3 h-3" />,
  manager: <UserCog className="w-3 h-3" />,
  admin:   <ShieldCheck className="w-3 h-3" />,
};

function fmtTime(secs: number) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function RoleSwitcher({ activeRole, loginRole, secondsLeft, isElevated, onElevate, onRevert }: RoleSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [pinTarget, setPinTarget] = useState<UserRole | null>(null);

  const meta = ROLE_META[activeRole];

  const handleSelect = (role: UserRole) => {
    setOpen(false);
    if (role === activeRole) return;
    // Going to same level or lower than CURRENT active role → no PIN needed
    if (ROLE_LEVEL[role] <= ROLE_LEVEL[activeRole]) {
      onElevate(role);
      return;
    }
    // Going higher than current active role → PIN required always
    setPinTarget(role);
  };

  const handlePinSuccess = () => {
    if (pinTarget) { onElevate(pinTarget); setPinTarget(null); }
  };

  // PIN required to elevate to pinTarget:
  // → manager: accept manager or admin PIN
  // → admin:   accept admin PIN only
  const pinRequired: "manager" | "admin" = pinTarget === "admin" ? "admin" : "manager";

  return (
    <>
      {/* PIN popup for role switching */}
      {pinTarget && (
        <PinGuard
          actionLabel={`Switch to ${ROLE_META[pinTarget].label} Mode`}
          requiredRole={pinRequired}
          onSuccess={handlePinSuccess}
          onCancel={() => setPinTarget(null)}
        />
      )}

      <div className="flex items-center gap-1 shrink-0">
        {/* Role badge — click to open picker */}
        <div className="relative">
          <button
            onClick={() => setOpen((v) => !v)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded border text-xs font-semibold transition-colors ${meta.bg} ${meta.color} ${meta.border}`}
          >
            {ROLE_ICONS[activeRole]}
            {meta.label}
            <ChevronDown className="w-3 h-3 opacity-60" />
          </button>

          {open && (
            <div
              className="absolute left-0 top-full mt-1 z-50 w-36 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden"
              onMouseLeave={() => setOpen(false)}
            >
              {(["staff", "manager", "admin"] as UserRole[]).map((role) => {
                const m = ROLE_META[role];
                const needsPin = ROLE_LEVEL[role] > ROLE_LEVEL[activeRole];
                const isCurrent = role === activeRole;
                return (
                  <button
                    key={role}
                    onClick={() => handleSelect(role)}
                    className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 text-xs font-semibold transition-colors text-left ${
                      isCurrent
                        ? `${m.bg} ${m.color}`
                        : "text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      {ROLE_ICONS[role]}
                      {m.label}
                    </span>
                    {needsPin && !isCurrent && <Lock className="w-2.5 h-2.5 opacity-50" />}
                    {isCurrent && <span className="w-1.5 h-1.5 rounded-full bg-current opacity-60" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Countdown + Lock button — only shown when elevated */}
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
