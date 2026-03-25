import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Sidebar } from "@/components/Sidebar";
import Dashboard from "@/pages/Dashboard";
import POS from "@/pages/POS";
import Orders from "@/pages/Orders";
import Menu from "@/pages/Menu";
import Inventory from "@/pages/Inventory";
import Reports from "@/pages/Reports";
import Admin from "@/pages/Admin";
import Settings from "@/pages/Settings";
import Tables from "@/pages/Tables";
import LiveAnalytics from "@/pages/LiveAnalytics";
import Login from "@/pages/Login";
import NotFound from "@/pages/not-found";
import { useAuth } from "@/hooks/useAuth";
import { Loader2 } from "lucide-react";

// Routes that should show full-screen (no sidebar)
const NO_SIDEBAR_ROUTES = ["/", "/tables", "/live-analytics"];

function Router() {
  const { isAuthenticated, isLoading } = useAuth();
  const [location] = useLocation();

  if (isLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <Login
        onLoginSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
        }}
      />
    );
  }

  // ── Full-screen pages (no sidebar) ──────────────────────────────────────
  if (NO_SIDEBAR_ROUTES.includes(location)) {
    if (location === "/live-analytics") return <LiveAnalytics />;
    return <Tables />;
  }

  // ── All other pages: sidebar layout ─────────────────────────────────────
  return (
    <div className="flex h-screen w-screen bg-background overflow-hidden">
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden">
        <Switch>
          <Route path="/dashboard" component={Dashboard} />
          <Route path="/pos" component={POS} />
          <Route path="/orders" component={Orders} />
          <Route path="/menu" component={Menu} />
          <Route path="/inventory" component={Inventory} />
          <Route path="/reports" component={Reports} />
          <Route path="/admin" component={Admin} />
          <Route path="/settings" component={Settings} />
          <Route component={NotFound} />
        </Switch>
      </div>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
