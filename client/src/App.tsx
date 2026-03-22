import { Switch, Route } from "wouter";
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
import KOT from "@/pages/KOT";
import Billing from "@/pages/Billing";
import Reports from "@/pages/Reports";
import Admin from "@/pages/Admin";
import Settings from "@/pages/Settings";
import Login from "@/pages/Login";
import NotFound from "@/pages/not-found";
import { useAuth } from "@/hooks/useAuth";
import { Loader2 } from "lucide-react";

function Router() {
  const { isAuthenticated, isLoading } = useAuth();

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

  return (
    <div className="flex h-screen w-screen bg-background overflow-hidden">
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden">
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/pos" component={POS} />
          <Route path="/orders" component={Orders} />
          <Route path="/menu" component={Menu} />
          <Route path="/inventory" component={Inventory} />
          <Route path="/kot" component={KOT} />
          <Route path="/billing" component={Billing} />
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
