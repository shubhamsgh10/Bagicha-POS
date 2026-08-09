import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import * as Sentry from "@sentry/react";
import { queryClient } from "./lib/queryClient";
import { RealtimeProvider } from "./hooks/RealtimeProvider";
import { ErrorBoundary } from "./components/ErrorBoundary";
// ── Bagicha design-system fonts (self-hosted, offline-safe for Electron) ──
import "@fontsource/plus-jakarta-sans/400.css";
import "@fontsource/plus-jakarta-sans/500.css";
import "@fontsource/plus-jakarta-sans/600.css";
import "@fontsource/plus-jakarta-sans/700.css";
import "@fontsource/plus-jakarta-sans/800.css";
import "@fontsource/cormorant-garamond/500.css";
import "@fontsource/cormorant-garamond/600.css";
import "@fontsource/cormorant-garamond/700.css";
import "@fontsource/cormorant-garamond/500-italic.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/700.css";
import App from "./App";
import "./index.css";

// VITE_SENTRY_DSN is optional — Sentry is a no-op when absent.
if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0.2,
    replaysOnErrorSampleRate: 1.0,   // full session replay on every error
  });
}

// Catch errors outside React's render cycle (event handlers, timers, promise
// rejections) — ErrorBoundary below only catches render/lifecycle throws, not these.
window.addEventListener("error", (event) => {
  console.error("[window.onerror]", event.error ?? event.message);
  Sentry.captureException(event.error ?? new Error(String(event.message)));
});
window.addEventListener("unhandledrejection", (event) => {
  console.error("[unhandledrejection]", event.reason);
  Sentry.captureException(event.reason);
});

// QueryClientProvider lives here (not inside App) because RealtimeProvider's
// useAuth() call needs a QueryClient ancestor and RealtimeProvider must wrap
// App so every consumer (usePrintJobBridge included, mounted at App's root)
// shares the one realtime connection. App no longer wraps its own — a second
// nested QueryClientProvider previously split the query cache (see CLAUDE.md).
createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <RealtimeProvider>
        <App />
      </RealtimeProvider>
    </QueryClientProvider>
  </ErrorBoundary>,
);
