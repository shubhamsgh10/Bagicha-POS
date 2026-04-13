import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TopNav } from "@/components/TopNav";
import { AppLayout } from "@/components/AppLayout";
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
import LiveTablesDashboard from "@/pages/LiveTablesDashboard";
import CustomerDashboard from "@/pages/CustomerDashboard";
import KOT from "@/pages/KOT";
import MobilePOS from "@/pages/MobilePOS";
import Kitchen from "@/pages/Kitchen";
import { BottomNav } from "@/components/BottomNav";
import Login from "@/pages/Login";
import NotFound from "@/pages/not-found";
import { RouteGuard } from "@/components/RouteGuard";
import { useAuth } from "@/hooks/useAuth";
import { ActiveRoleProvider } from "@/context/ActiveRoleContext";
import { Loader2 } from "lucide-react";

function Router() {
  const { isAuthenticated, isLoading } = useAuth();
  const [location] = useLocation();

  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <Login
        onLoginSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
          window.history.replaceState(null, "", "/tables");
        }}
      />
    );
  }

  // Full-screen routes — no TopNav
  if (location.startsWith("/pos")) return <POS />;
  if (location.startsWith("/mobile-pos")) return <MobilePOS />;

  // All other pages: TopNav + page content + BottomNav (mobile)
  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      <TopNav />
      {/* app-page-content — strips light bg from page roots so dark AppLayout bg shows through */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden app-page-content">
        <RouteGuard>
          <Switch>
            <Route path="/"               component={Tables} />
            <Route path="/tables"         component={Tables} />
            <Route path="/dashboard"      component={Dashboard} />
            <Route path="/orders"         component={Orders} />
            <Route path="/menu"           component={Menu} />
            <Route path="/inventory"      component={Inventory} />
            <Route path="/reports"        component={Reports} />
            <Route path="/admin"          component={Admin} />
            <Route path="/settings"       component={Settings} />
            <Route path="/live-analytics" component={LiveAnalytics} />
            <Route path="/live-tables"   component={LiveTablesDashboard} />
            <Route path="/customers"     component={CustomerDashboard} />
            <Route path="/kitchen"       component={Kitchen} />
            <Route path="/kot"           component={KOT} />
            <Route component={NotFound} />
          </Switch>
        </RouteGuard>
      </div>
      <BottomNav />
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <ActiveRoleProvider>
          <AppLayout>
            <Router />
          </AppLayout>
        </ActiveRoleProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
