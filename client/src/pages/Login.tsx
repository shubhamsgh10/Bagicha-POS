import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { BagichaLogo } from "@/components/BagichaLogo";
import bagichaLogoImg from "@assets/Bagicha Logo.png";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Loader2 } from "lucide-react";
import bgImage from "@assets/Login Page Background.png";

const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

type LoginForm = z.infer<typeof loginSchema>;

interface LoginProps {
  onLoginSuccess: () => void;
}

export default function Login({ onLoginSuccess }: LoginProps) {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginForm) => {
    setLoading(true);
    try {
      await apiRequest("POST", "/api/auth/login", data);
      onLoginSuccess();
    } catch (err: any) {
      const message = err.message?.includes("401")
        ? "Invalid username or password"
        : "Login failed. Please try again.";
      toast({ title: "Login Failed", description: message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-bg" style={{ backgroundImage: `url(${bgImage})` }}>
      <div className="login-content">
        <div className="login-logo-area">
          <img
            src={bagichaLogoImg}
            alt="Bagicha"
            className="login-logo-img"
          />
          <p className="login-tagline">Restaurant POS System</p>
        </div>

        <Card className="login-card">
          <CardHeader className="space-y-1">
            <CardTitle className="login-title">Sign in</CardTitle>
            <CardDescription className="login-desc">
              Enter your credentials to access the dashboard
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username" className="login-label">Username</Label>
                <Input
                  id="username"
                  placeholder="admin"
                  autoComplete="username"
                  className="login-input"
                  {...register("username")}
                />
                {errors.username && (
                  <p className="text-xs login-error">{errors.username.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="login-label">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className="login-input"
                  {...register("password")}
                />
                {errors.password && (
                  <p className="text-xs login-error">{errors.password.message}</p>
                )}
              </div>

              <Button type="submit" className="w-full login-btn" disabled={loading}>
                {loading ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Signing in...</>
                ) : "Sign in"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
