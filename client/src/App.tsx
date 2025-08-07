import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Sidebar } from "@/components/Sidebar";
import { Header } from "@/components/Header";
import Dashboard from "@/pages/Dashboard";
import Orders from "@/pages/Orders";
import Menu from "@/pages/Menu";
import Inventory from "@/pages/Inventory";
import KOT from "@/pages/KOT";
import Billing from "@/pages/Billing";
import Reports from "@/pages/Reports";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <div className="flex h-screen w-screen bg-background">
      <Sidebar />
      <div className="flex flex-col flex-1 h-screen">
        {/* Header always fixed at the top */}
        {/* Main content area is scrollable */}
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
          <Switch>
            <Route path="/" component={Dashboard} />
            <Route path="/orders" component={Orders} />
            <Route path="/menu" component={Menu} />
            <Route path="/inventory" component={Inventory} />
            <Route path="/kot" component={KOT} />
            <Route path="/billing" component={Billing} />
            <Route path="/reports" component={Reports} />
            <Route component={NotFound} />
          </Switch>
        </div>
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
