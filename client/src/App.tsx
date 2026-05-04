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
import Billing from "@/pages/Billing";
import Staff from "@/pages/Staff";
import KOT from "@/pages/KOT";
import MobilePOS from "@/pages/MobilePOS";
import Kitchen from "@/pages/Kitchen";
import PublicFeedback from "@/pages/PublicFeedback";
import { BottomNav } from "@/components/BottomNav";
import Login from "@/pages/Login";
import NotFound from "@/pages/not-found";
import { RouteGuard } from "@/components/RouteGuard";
import { useAuth } from "@/hooks/useAuth";
import { ActiveRoleProvider } from "@/context/ActiveRoleContext";
import { NavigationProvider, useNavigation, NavDirection } from "@/context/NavigationContext";
import { useSwipeBack } from "@/hooks/useSwipeBack";
import { Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect, useRef } from "react";

const PUSH_DURATION = 480; // ms — login↔app panel push transition

// Page-level slide variants — x in pixels (subtle, app-like feel).
// Both exiting and entering divs will render the new Switch content
// (Switch re-evaluates wouter location immediately). The exiting div
// fades to opacity:0 so only the entering slide is visually dominant.
const pageVariants = {
  enter: (dir: NavDirection) => ({
    x: dir === "forward" ? 60 : -60,
    opacity: 0,
    scale: 0.99,
  }),
  center: { x: 0, opacity: 1, scale: 1 },
  exit:  (dir: NavDirection) => ({
    x: dir === "forward" ? -60 : 60,
    opacity: 0,
    scale: 0.99,
  }),
};

// [0.22, 1, 0.36, 1] — identical physics for both directions:
// quick acceleration, long smooth glide, symmetric deceleration tail.
const pageTrans = { duration: 0.42, ease: [0.22, 1, 0.36, 1] as const };

function Router() {
  const { isAuthenticated, isLoading } = useAuth();
  const [location] = useLocation();
  const { direction, goBack, canGoBack } = useNavigation();

  // Swipe-back gesture — only when authenticated and there's history
  useSwipeBack(goBack, isAuthenticated && canGoBack);

  // Once the initial auth check completes, never show the spinner again.
  // queryClient.clear() on logout causes isLoading to briefly flip true,
  // which would unmount the panels and kill the push animation.
  const initialLoadDoneRef = useRef(false);
  if (!isLoading) initialLoadDoneRef.current = true;
  const showSpinner = isLoading && !initialLoadDoneRef.current;

  // Keep app content mounted for PUSH_DURATION ms after logout so it stays
  // visible while the panel slides away (prevents blank-panel logout animation).
  const [showAppContent, setShowAppContent] = useState(isAuthenticated);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isAuthenticated) {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      setShowAppContent(true);
    } else {
      hideTimerRef.current = setTimeout(() => setShowAppContent(false), PUSH_DURATION);
    }
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [isAuthenticated]);

  if (showSpinner) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  // Public, no-auth routes — render before the auth gate
  if (location.startsWith("/feedback/")) return <PublicFeedback />;

  // Full-screen routes — skip push wrapper and page transitions
  if (isAuthenticated && location.startsWith("/pos"))        return <POS />;
  if (isAuthenticated && location.startsWith("/mobile-pos")) return <MobilePOS />;

  const pushTransition = { duration: PUSH_DURATION / 1000, ease: [0.4, 0, 0.2, 1] as const };

  return (
    <div style={{ position: "fixed", inset: 0, overflow: "hidden" }}>

      {/* ── Login panel: x:0 when logged out, x:-100% when logged in ── */}
      <motion.div
        initial={{ x: isAuthenticated ? "-100%" : "0%" }}
        animate={{ x: isAuthenticated ? "-100%" : "0%" }}
        transition={pushTransition}
        style={{ position: "absolute", inset: 0, zIndex: 10 }}
      >
        <Login
          onLoginSuccess={() => {
            // Warm the tables cache before Tables mounts
            queryClient.prefetchQuery({
              queryKey: ["/api/tables"],
              queryFn: () => fetch("/api/tables", { credentials: "include" }).then(r => r.json()),
              staleTime: 0,
            });
            queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
            window.history.replaceState(null, "", "/tables");
          }}
        />
      </motion.div>

      {/* ── App panel: x:0 when logged in, x:100% when logged out ── */}
      <motion.div
        initial={{ x: isAuthenticated ? "0%" : "100%" }}
        animate={{ x: isAuthenticated ? "0%" : "100%" }}
        transition={pushTransition}
        style={{
          position: "absolute", inset: 0,
          display: "flex", flexDirection: "column",
          overflow: "hidden",
          willChange: "transform",
        }}
      >
        {showAppContent && (
          <>
            <TopNav />

            {/* Page content area — CSS grid so each page fills the single cell.
                All motion.divs share grid-area 1/1 and overlap during animation.
                No overflow:hidden here — the app panel above already clips the
                animation at screen edges. Keeping this open lets touch scroll
                events reach inner scroll containers unblocked. */}
            <div
              className="flex-1 min-h-0 app-page-content"
              style={{ display: "grid", gridTemplateRows: "1fr", minHeight: 0 }}
            >
              <RouteGuard>
                <AnimatePresence custom={direction} initial={false}>
                  <motion.div
                    key={location}
                    custom={direction}
                    variants={pageVariants}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={pageTrans}
                    style={{
                      gridArea: "1 / 1",
                      minHeight: 0,
                      overflow: "auto",
                      willChange: "transform, opacity",
                    }}
                  >
                    <Switch>
                      <Route path="/"               component={Tables} />
                      <Route path="/tables"         component={Tables} />
                      <Route path="/dashboard"      component={Dashboard} />
                      <Route path="/billing"        component={Billing} />
                      <Route path="/staff"          component={Staff} />
                      <Route path="/orders"         component={Orders} />
                      <Route path="/menu"           component={Menu} />
                      <Route path="/inventory"      component={Inventory} />
                      <Route path="/reports"        component={Reports} />
                      <Route path="/admin"          component={Admin} />
                      <Route path="/settings"       component={Settings} />
                      <Route path="/live-analytics" component={LiveAnalytics} />
                      <Route path="/live-tables"    component={LiveTablesDashboard} />
                      <Route path="/customers"      component={CustomerDashboard} />
                      <Route path="/kitchen"        component={Kitchen} />
                      <Route path="/kot"            component={KOT} />
                      <Route component={NotFound} />
                    </Switch>
                  </motion.div>
                </AnimatePresence>
              </RouteGuard>
            </div>

            <BottomNav />
          </>
        )}
      </motion.div>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <ActiveRoleProvider>
          {/* NavigationProvider tracks history stack + direction for page transitions */}
          <NavigationProvider>
            <AppLayout>
              <Router />
            </AppLayout>
          </NavigationProvider>
        </ActiveRoleProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
