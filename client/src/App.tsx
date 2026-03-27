import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TopNav } from "@/components/TopNav";
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
import KOT from "@/pages/KOT";
import Login from "@/pages/Login";
import NotFound from "@/pages/not-found";
import { useAuth } from "@/hooks/useAuth";
import { Loader2 } from "lucide-react";

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

  // POS is completely full-screen — has its own header
  if (location.startsWith("/pos")) {
    return <POS />;
  }

  // All other pages: TopNav + page content (no sidebar)
  return (
    <div className="flex flex-col h-full w-screen bg-background overflow-hidden">
      <TopNav />
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
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
          <Route path="/kot"            component={KOT} />
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
