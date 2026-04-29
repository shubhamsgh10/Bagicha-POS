import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion, AnimatePresence } from "framer-motion";
import bagichaLogoImg from "@assets/Bagicha Logo.png";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Loader2, Delete, ChevronLeft, Eye, EyeOff } from "lucide-react";
import bgImage from "@assets/Login Page Background.png";

/* ─── Types ─── */
interface LoginProps  { onLoginSuccess: () => void; }
interface StaffMember { id: number; name: string; }
interface DeviceCtx  { isLocalNetwork: boolean; isMobile: boolean; }

const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});
type LoginForm = z.infer<typeof loginSchema>;

/* ─── Avatar palette ─── */
const AVATAR_GRADIENTS: [string, string][] = [
  ["#10b981", "#059669"],
  ["#0ea5e9", "#0284c7"],
  ["#8b5cf6", "#7c3aed"],
  ["#f59e0b", "#d97706"],
  ["#ef4444", "#dc2626"],
  ["#ec4899", "#db2777"],
  ["#14b8a6", "#0d9488"],
  ["#6366f1", "#4f46e5"],
];

function getAvatarColors(name: string): [string, string] {
  const idx = name.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0) % AVATAR_GRADIENTS.length;
  return AVATAR_GRADIENTS[idx];
}

function getInitials(name: string) {
  return name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
}

/* ─── Shared glass card style ─── */
const glassCard: React.CSSProperties = {
  background:      "rgba(255,255,255,0.42)",
  backdropFilter:  "blur(28px) saturate(1.9)",
  WebkitBackdropFilter: "blur(28px) saturate(1.9)",
  border:          "1px solid rgba(255,255,255,0.60)",
  boxShadow:       "0 12px 40px rgba(0,0,0,0.10), 0 1px 0 rgba(255,255,255,0.85) inset",
  borderRadius:    "20px",
};

/* ─── PIN Dots ─── */
function PinDots({ value, shake }: { value: string; shake: boolean }) {
  return (
    <motion.div
      animate={shake ? { x: [0, -9, 9, -7, 7, -4, 4, 0] } : {}}
      transition={{ duration: 0.38 }}
      className="flex gap-3.5 justify-center my-5"
    >
      {Array.from({ length: 6 }).map((_, i) => (
        <motion.div
          key={i}
          animate={{ scale: value.length > i ? 1.25 : 1 }}
          transition={{ type: "spring", stiffness: 500, damping: 22 }}
          className={`w-3 h-3 rounded-full border-2 transition-colors duration-100 ${
            value.length > i
              ? "bg-emerald-500 border-emerald-500"
              : "border-gray-300 bg-transparent"
          }`}
          style={value.length > i ? { boxShadow: "0 0 10px rgba(16,185,129,0.55)" } : {}}
        />
      ))}
    </motion.div>
  );
}

/* ─── PIN Pad ─── */
const PIN_KEYS = ["1","2","3","4","5","6","7","8","9","","0","⌫"];

function PinPad({
  onDigit, onDelete, disabled,
}: {
  onDigit: (d: string) => void;
  onDelete: () => void;
  disabled?: boolean;
}) {
  const keyStyle: React.CSSProperties = {
    background:     "rgba(255,255,255,0.68)",
    backdropFilter: "blur(10px)",
    border:         "1px solid rgba(255,255,255,0.75)",
    boxShadow:      "0 2px 8px rgba(0,0,0,0.07), 0 1px 0 rgba(255,255,255,0.95) inset",
    borderRadius:   "16px",
  };

  return (
    <div className="grid grid-cols-3 gap-2.5 w-64 mx-auto">
      {PIN_KEYS.map((k, i) => {
        if (k === "") return <div key={i} />;
        if (k === "⌫") return (
          <motion.button key={i} whileTap={{ scale: 0.86 }} disabled={disabled}
            onClick={onDelete}
            className="h-[62px] flex items-center justify-center text-gray-500 disabled:opacity-40 active:bg-red-50 transition-colors"
            style={keyStyle}
          >
            <Delete className="w-5 h-5" />
          </motion.button>
        );
        return (
          <motion.button key={i} whileTap={{ scale: 0.86 }} disabled={disabled}
            onClick={() => onDigit(k)}
            className="h-[62px] text-[1.5rem] font-semibold text-gray-800 disabled:opacity-40 transition-colors"
            style={keyStyle}
          >
            {k}
          </motion.button>
        );
      })}
    </div>
  );
}

/* ─── Staff Selector ─── */
function StaffSelector({ onLoginSuccess }: LoginProps) {
  const { toast } = useToast();
  const [staff, setStaff]     = useState<StaffMember[]>([]);
  const [selected, setSelected] = useState<StaffMember | null>(null);
  const [pin, setPin]         = useState("");
  const [loading, setLoading] = useState(false);
  const [shake, setShake]     = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showPw, setShowPw]   = useState(false);
  const [adminLoading, setAdminLoading] = useState(false);

  const { register, handleSubmit, formState: { errors } } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
  });

  useEffect(() => {
    fetch("/api/staff-members", { credentials: "include" })
      .then(r => r.json())
      .then((m: StaffMember[]) => setStaff(m))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (pin.length === 6 && selected) submitPin();
  }, [pin]);

  async function submitPin() {
    if (!selected) return;
    setLoading(true);
    try {
      await apiRequest("POST", "/api/auth/staff-pin-login", { staffId: selected.id, pin });
      onLoginSuccess();
    } catch (err: any) {
      setShake(true);
      setTimeout(() => setShake(false), 400);
      setPin("");
      toast({
        title: err.message?.includes("No PIN") ? "No PIN set — ask your manager." : "Wrong PIN. Try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  async function onAdminSubmit(data: LoginForm) {
    setAdminLoading(true);
    try {
      await apiRequest("POST", "/api/auth/login", data);
      onLoginSuccess();
    } catch {
      toast({ title: "Invalid username or password", variant: "destructive" });
    } finally {
      setAdminLoading(false);
    }
  }

  const bgStyle: React.CSSProperties = {
    backgroundImage:    `url(${bgImage})`,
    backgroundSize:     "100% 100%",
    backgroundPosition: "center",
  };

  /* ── Admin login ── */
  if (showAdmin) return (
    <div className="login-bg" style={bgStyle}>
      <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-[22rem] px-5">
        <div className="flex flex-col items-center mb-5">
          <img src={bagichaLogoImg} alt="Bagicha" className="login-logo-img" />
        </div>
        <div style={glassCard} className="p-6 space-y-4">
          <button onClick={() => setShowAdmin(false)}
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 transition-colors -mb-1">
            <ChevronLeft className="w-3.5 h-3.5" /> Back to staff
          </button>
          <div>
            <h2 className="text-lg font-bold text-gray-900 tracking-tight">Manager Login</h2>
            <p className="text-xs text-gray-500 mt-0.5">Restricted access — credentials required</p>
          </div>
          <form onSubmit={handleSubmit(onAdminSubmit)} className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-gray-700">Username</label>
              <input {...register("username")} placeholder="admin" autoComplete="username"
                className="login-input w-full h-11 px-3 text-sm" />
              {errors.username && <p className="text-xs text-red-500">{errors.username.message}</p>}
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-gray-700">Password</label>
              <div className="relative">
                <input {...register("password")}
                  type={showPw ? "text" : "password"}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className="login-input w-full h-11 px-3 pr-10 text-sm" />
                <button type="button" onClick={() => setShowPw(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {errors.password && <p className="text-xs text-red-500">{errors.password.message}</p>}
            </div>
            <button type="submit" disabled={adminLoading}
              className="login-btn w-full h-11 flex items-center justify-center gap-2 mt-1">
              {adminLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Signing in…</> : "Sign in"}
            </button>
          </form>
        </div>
      </motion.div>
    </div>
  );

  /* ── PIN entry ── */
  if (selected) {
    const [from, to] = getAvatarColors(selected.name);
    return (
      <div className="login-bg" style={bgStyle}>
        <motion.div initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }}
          transition={{ type: "spring", stiffness: 280, damping: 26 }}
          className="w-full max-w-[22rem] px-5">
          <div className="flex flex-col items-center mb-5">
            <img src={bagichaLogoImg} alt="Bagicha" className="login-logo-img" />
          </div>
          <div style={glassCard} className="px-6 pt-6 pb-5 text-center">
            {/* Avatar */}
            <motion.div
              initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 320, damping: 22 }}
              className="w-[68px] h-[68px] rounded-full mx-auto mb-2.5 flex items-center justify-center text-white font-bold text-xl"
              style={{
                background:  `linear-gradient(135deg, ${from} 0%, ${to} 100%)`,
                boxShadow:   `0 6px 20px ${from}55, 0 2px 6px rgba(0,0,0,0.12)`,
              }}
            >
              {getInitials(selected.name)}
            </motion.div>

            <h2 className="text-[15px] font-bold text-gray-900">{selected.name}</h2>
            <p className="text-xs text-gray-400 mt-0.5 mb-1">Enter your 6-digit PIN</p>

            <PinDots value={pin} shake={shake} />

            {loading ? (
              <div className="flex justify-center py-7">
                <Loader2 className="w-7 h-7 animate-spin text-emerald-500" />
              </div>
            ) : (
              <PinPad
                onDigit={d => setPin(p => p.length < 6 ? p + d : p)}
                onDelete={() => setPin(p => p.slice(0, -1))}
                disabled={loading}
              />
            )}

            <button onClick={() => { setSelected(null); setPin(""); }}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 mx-auto mt-4 transition-colors">
              <ChevronLeft className="w-3.5 h-3.5" /> Back
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  /* ── Staff grid ── */
  return (
    <div className="login-bg" style={bgStyle}>
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-[22rem] px-5">
        <div className="flex flex-col items-center mb-5">
          <img src={bagichaLogoImg} alt="Bagicha" className="login-logo-img mb-1" />
          <p className="text-[11px] text-gray-400 uppercase tracking-[0.12em] mt-1 font-medium">
            Who are you?
          </p>
        </div>

        <div style={glassCard} className="px-4 pt-5 pb-4">
          {staff.length === 0 ? (
            <div className="text-center py-8 space-y-1">
              <p className="text-sm text-gray-400">No staff accounts found.</p>
              <p className="text-xs text-gray-300">Ask admin to create accounts.</p>
            </div>
          ) : (
            <div className={`grid gap-2.5 ${staff.length > 4 ? "grid-cols-3" : "grid-cols-2"}`}>
              {staff.map((s, idx) => {
                const [from, to] = getAvatarColors(s.name);
                return (
                  <motion.button
                    key={s.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.05, type: "spring", stiffness: 320, damping: 28 }}
                    whileTap={{ scale: 0.91 }}
                    onClick={() => { setSelected(s); setPin(""); }}
                    className="group flex flex-col items-center gap-2.5 py-4 px-2 rounded-2xl transition-all duration-200 active:brightness-95"
                    style={{
                      background:  "rgba(255,255,255,0.58)",
                      border:      "1px solid rgba(255,255,255,0.75)",
                      boxShadow:   "0 2px 10px rgba(0,0,0,0.06)",
                    }}
                  >
                    <div
                      className="w-14 h-14 rounded-full flex items-center justify-center text-white font-bold text-[1.1rem] transition-transform duration-200 group-hover:scale-105 group-active:scale-95"
                      style={{
                        background: `linear-gradient(135deg, ${from} 0%, ${to} 100%)`,
                        boxShadow:  `0 4px 14px ${from}44`,
                      }}
                    >
                      {getInitials(s.name)}
                    </div>
                    <span className="text-[11.5px] font-semibold text-gray-700 text-center leading-tight px-1">
                      {s.name}
                    </span>
                  </motion.button>
                );
              })}
            </div>
          )}

          <div className="mt-4 pt-3.5 border-t border-white/50 text-center">
            <button onClick={() => setShowAdmin(true)}
              className="text-[11px] text-gray-400 hover:text-gray-600 transition-colors font-medium">
              Manager / Admin Login →
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

/* ─── Root Login ─── */
export default function Login({ onLoginSuccess }: LoginProps) {
  const { toast }  = useToast();
  const [ctx, setCtx]   = useState<DeviceCtx | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPw, setShowPw]   = useState(false);

  const { register, handleSubmit, formState: { errors } } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
  });

  useEffect(() => {
    fetch("/api/auth/context", { credentials: "include" })
      .then(r => r.json())
      .then(setCtx)
      .catch(() => setCtx({ isLocalNetwork: false, isMobile: false }));
  }, []);

  if (ctx?.isLocalNetwork && ctx?.isMobile) {
    return <StaffSelector onLoginSuccess={onLoginSuccess} />;
  }

  async function onSubmit(data: LoginForm) {
    setLoading(true);
    try {
      await apiRequest("POST", "/api/auth/login", data);
      onLoginSuccess();
    } catch (err: any) {
      toast({
        title:       "Login Failed",
        description: err.message?.includes("401") ? "Invalid username or password" : "Login failed.",
        variant:     "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-bg" style={{ backgroundImage: `url(${bgImage})` }}>
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 260, damping: 24 }}
        className="w-full max-w-[22rem] px-5">
        <div className="flex flex-col items-center mb-6">
          <img src={bagichaLogoImg} alt="Bagicha" className="login-logo-img mb-2" />
          <p className="text-[11px] text-gray-400 uppercase tracking-[0.12em] font-medium">
            Restaurant POS
          </p>
        </div>

        <div style={glassCard} className="p-6 space-y-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900 tracking-tight">Sign in</h2>
            <p className="text-xs text-gray-500 mt-0.5">Enter your credentials to continue</p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-gray-700">Username</label>
              <input {...register("username")} placeholder="admin" autoComplete="username"
                className="login-input w-full h-11 px-3 text-sm" />
              {errors.username && <p className="text-xs text-red-500">{errors.username.message}</p>}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-gray-700">Password</label>
              <div className="relative">
                <input {...register("password")}
                  type={showPw ? "text" : "password"}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className="login-input w-full h-11 px-3 pr-10 text-sm" />
                <button type="button" onClick={() => setShowPw(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors">
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {errors.password && <p className="text-xs text-red-500">{errors.password.message}</p>}
            </div>

            <button type="submit" disabled={loading}
              className="login-btn w-full h-11 flex items-center justify-center gap-2 mt-1">
              {loading
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Signing in…</>
                : "Sign in"}
            </button>
          </form>
        </div>
      </motion.div>
    </div>
  );
}
