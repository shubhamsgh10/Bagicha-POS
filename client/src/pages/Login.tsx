import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion, AnimatePresence } from "framer-motion";
import bagichaLogoImg from "@assets/Bagicha Logo.png";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Loader2, Delete, User, ChevronLeft } from "lucide-react";
import bgImage from "@assets/Login Page Background.png";

// ── types ─────────────────────────────────────────────────────────────────────

interface LoginProps { onLoginSuccess: () => void; }
interface StaffUser  { id: number; username: string; role: string; }
interface DeviceCtx  { isLocalNetwork: boolean; isMobile: boolean; }

const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});
type LoginForm = z.infer<typeof loginSchema>;

// ── PIN pad ───────────────────────────────────────────────────────────────────

function PinDots({ value }: { value: string }) {
  return (
    <div className="flex gap-3 justify-center my-4">
      {[0, 1, 2, 3].map(i => (
        <motion.div
          key={i}
          animate={{ scale: value.length > i ? 1.15 : 1 }}
          transition={{ type: "spring", stiffness: 400, damping: 20 }}
          className={`w-4 h-4 rounded-full border-2 transition-colors ${
            value.length > i ? "bg-primary border-primary" : "border-muted-foreground/40"
          }`}
        />
      ))}
    </div>
  );
}

function PinPad({ onDigit, onDelete }: { onDigit: (d: string) => void; onDelete: () => void }) {
  const keys = ["1","2","3","4","5","6","7","8","9","","0","⌫"];
  return (
    <div className="grid grid-cols-3 gap-2 w-56 mx-auto">
      {keys.map((k, i) =>
        k === "" ? <div key={i} /> :
        k === "⌫" ? (
          <button key={i} onClick={onDelete}
            className="h-14 rounded-xl bg-muted flex items-center justify-center active:scale-95 transition-transform">
            <Delete className="w-5 h-5 text-muted-foreground" />
          </button>
        ) : (
          <button key={i} onClick={() => onDigit(k)}
            className="h-14 rounded-xl bg-card border text-xl font-semibold active:scale-95 active:bg-primary/10 transition-transform shadow-sm">
            {k}
          </button>
        )
      )}
    </div>
  );
}

// ── Staff selector screen ─────────────────────────────────────────────────────

function StaffSelector({ onLoginSuccess }: LoginProps) {
  const { toast } = useToast();
  const [staff, setStaff]               = useState<StaffUser[]>([]);
  const [selected, setSelected]         = useState<StaffUser | null>(null);
  const [pin, setPin]                   = useState("");
  const [loading, setLoading]           = useState(false);
  const [shakeKey, setShakeKey]         = useState(0);
  const [showAdminLogin, setShowAdminLogin] = useState(false);

  // Normal login form state
  const [adminLoading, setAdminLoading] = useState(false);
  const {
    register, handleSubmit, formState: { errors },
  } = useForm<LoginForm>({ resolver: zodResolver(loginSchema) });

  useEffect(() => {
    fetch("/api/users", { credentials: "include" })
      .then(r => r.json())
      .then((users: StaffUser[]) => setStaff(users.filter(u => u.role === "staff")))
      .catch(() => {});
  }, []);

  // Auto-submit when 4 digits entered
  useEffect(() => {
    if (pin.length === 4 && selected) submitPin();
  }, [pin]);

  async function submitPin() {
    if (!selected) return;
    setLoading(true);
    try {
      await apiRequest("POST", "/api/auth/staff-pin-login", { userId: selected.id, pin });
      onLoginSuccess();
    } catch (err: any) {
      setShakeKey(k => k + 1);
      setPin("");
      const msg = err.message?.includes("No PIN")
        ? "No PIN set — ask your manager to set one in Admin settings."
        : "Wrong PIN. Try again.";
      toast({ title: msg, variant: "destructive" });
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

  // ── Admin login overlay ───────────────────────────────────────────────────

  if (showAdminLogin) {
    return (
      <div className="login-bg" style={{ backgroundImage: `url(${bgImage})` }}>
        <div className="login-content">
          <div className="login-logo-area">
            <img src={bagichaLogoImg} alt="Bagicha" className="login-logo-img" />
          </div>
          <Card className="login-card">
            <CardHeader>
              <button onClick={() => setShowAdminLogin(false)}
                className="flex items-center gap-1 text-xs text-muted-foreground mb-2 hover:text-foreground transition-colors w-fit">
                <ChevronLeft className="w-3.5 h-3.5" /> Back to staff login
              </button>
              <CardTitle className="login-title">Manager / Admin Login</CardTitle>
              <CardDescription className="login-desc">Enter your credentials</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit(onAdminSubmit)} className="space-y-4">
                <div className="space-y-2">
                  <Label className="login-label">Username</Label>
                  <Input placeholder="admin" autoComplete="username" className="login-input" {...register("username")} />
                  {errors.username && <p className="text-xs login-error">{errors.username.message}</p>}
                </div>
                <div className="space-y-2">
                  <Label className="login-label">Password</Label>
                  <Input type="password" placeholder="••••••••" autoComplete="current-password" className="login-input" {...register("password")} />
                  {errors.password && <p className="text-xs login-error">{errors.password.message}</p>}
                </div>
                <Button type="submit" className="w-full login-btn" disabled={adminLoading}>
                  {adminLoading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Signing in...</> : "Sign in"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // ── PIN screen ────────────────────────────────────────────────────────────

  if (selected) {
    return (
      <div className="login-bg" style={{ backgroundImage: `url(${bgImage})` }}>
        <div className="login-content">
          <div className="login-logo-area">
            <img src={bagichaLogoImg} alt="Bagicha" className="login-logo-img" />
          </div>
          <Card className="login-card">
            <CardContent className="pt-6 pb-4">
              <div className="text-center mb-2">
                <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
                  <User className="w-7 h-7 text-primary" />
                </div>
                <h2 className="text-lg font-semibold">{selected.username}</h2>
                <p className="text-sm text-muted-foreground capitalize">{selected.role}</p>
              </div>

              {/* PIN dots with shake on wrong */}
              <motion.div
                key={shakeKey}
                animate={shakeKey > 0 ? { x: [0, -10, 10, -8, 8, -4, 4, 0] } : {}}
                transition={{ duration: 0.4 }}
              >
                <PinDots value={pin} />
                {shakeKey > 0 && (
                  <p className="text-center text-xs text-red-500 mb-2">Wrong PIN</p>
                )}
              </motion.div>

              {loading
                ? <div className="flex justify-center py-4"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
                : <PinPad onDigit={d => setPin(p => p.length < 4 ? p + d : p)} onDelete={() => setPin(p => p.slice(0, -1))} />
              }

              <button onClick={() => { setSelected(null); setPin(""); }}
                className="flex items-center gap-1 text-xs text-muted-foreground mx-auto mt-4 hover:text-foreground transition-colors">
                <ChevronLeft className="w-3.5 h-3.5" /> Back
              </button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // ── Staff grid ────────────────────────────────────────────────────────────

  return (
    <div className="login-bg" style={{ backgroundImage: `url(${bgImage})` }}>
      <div className="login-content">
        <div className="login-logo-area">
          <img src={bagichaLogoImg} alt="Bagicha" className="login-logo-img" />
          <p className="login-tagline">Who are you?</p>
        </div>

        <Card className="login-card">
          <CardContent className="pt-5 pb-4">
            {staff.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground text-sm">
                No staff accounts found.<br />
                <span className="text-xs">Ask admin to create staff accounts.</span>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {staff.map(s => (
                  <motion.button
                    key={s.id}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => { setSelected(s); setPin(""); }}
                    className="flex flex-col items-center gap-2 p-4 rounded-xl border bg-card hover:bg-primary/5 hover:border-primary/40 transition-colors shadow-sm"
                  >
                    <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                      <User className="w-6 h-6 text-primary" />
                    </div>
                    <span className="text-sm font-medium text-center leading-tight">{s.username}</span>
                  </motion.button>
                ))}
              </div>
            )}

            <div className="mt-5 pt-4 border-t text-center">
              <button
                onClick={() => setShowAdminLogin(true)}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Manager / Admin Login →
              </button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ── Root login — picks mode based on device context ───────────────────────────

export default function Login({ onLoginSuccess }: LoginProps) {
  const { toast } = useToast();
  const [ctx, setCtx]       = useState<DeviceCtx | null>(null);
  const [loading, setLoading] = useState(false);
  const { register, handleSubmit, formState: { errors } } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
  });

  useEffect(() => {
    fetch("/api/auth/context", { credentials: "include" })
      .then(r => r.json())
      .then(setCtx)
      .catch(() => setCtx({ isLocalNetwork: false, isMobile: false }));
  }, []);

  // Show staff selector on local network mobile devices
  if (ctx?.isLocalNetwork && ctx?.isMobile) {
    return <StaffSelector onLoginSuccess={onLoginSuccess} />;
  }

  // Normal login for manager PC (or any non-mobile / non-local device)
  async function onSubmit(data: LoginForm) {
    setLoading(true);
    try {
      await apiRequest("POST", "/api/auth/login", data);
      onLoginSuccess();
    } catch (err: any) {
      toast({
        title: "Login Failed",
        description: err.message?.includes("401") ? "Invalid username or password" : "Login failed. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-bg" style={{ backgroundImage: `url(${bgImage})` }}>
      <div className="login-content">
        <div className="login-logo-area">
          <img src={bagichaLogoImg} alt="Bagicha" className="login-logo-img" />
          <p className="login-tagline">Restaurant POS System</p>
        </div>
        <Card className="login-card">
          <CardHeader className="space-y-1">
            <CardTitle className="login-title">Sign in</CardTitle>
            <CardDescription className="login-desc">Enter your credentials to access the dashboard</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username" className="login-label">Username</Label>
                <Input id="username" placeholder="admin" autoComplete="username" className="login-input" {...register("username")} />
                {errors.username && <p className="text-xs login-error">{errors.username.message}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="password" className="login-label">Password</Label>
                <Input id="password" type="password" placeholder="••••••••" autoComplete="current-password" className="login-input" {...register("password")} />
                {errors.password && <p className="text-xs login-error">{errors.password.message}</p>}
              </div>
              <Button type="submit" className="w-full login-btn" disabled={loading}>
                {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Signing in...</> : "Sign in"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
