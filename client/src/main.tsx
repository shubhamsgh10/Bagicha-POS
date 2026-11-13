import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { persistOptions } from "./lib/queryPersistence";
import { PERSIST_MAX_AGE_MS } from "./lib/persistPolicy";
import * as Sentry from "@sentry/react";
import { queryClient } from "./lib/queryClient";
import { RealtimeProvider } from "./hooks/RealtimeProvider";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { installSlowRequestReporter } from "./lib/slowRequest";
import { installStallBreaker } from "./lib/stallReset";

// Every API request >= 4s (or timed out) is reported with the server's own timing — see lib/slowRequest.ts.
installSlowRequestReporter();
// Desktop app only: retry a request stuck on a silently dead connection after ~3 s instead of 10–20 s.
installStallBreaker();
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
// Desktop app only: saved screen data (IndexedDB) shows instantly at startup and during an
// outage. Browsers/phones keep the plain provider and behave exactly as before.
const persist = !!(window as any).electronAPI?.isElectron;
// A query dropped from memory (default: 5 min unused) also drops out of the saved copy, so keep
// them as long as the saved copy lives — else screens not opened recently aren't instant next start.
if (persist) {
  const defaults = queryClient.getDefaultOptions();
  queryClient.setDefaultOptions({ ...defaults, queries: { ...defaults.queries, gcTime: PERSIST_MAX_AGE_MS } });
}
const tree = (
  <RealtimeProvider>
    <App />
  </RealtimeProvider>
);

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    {persist ? (
      <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
        {tree}
      </PersistQueryClientProvider>
    ) : (
      <QueryClientProvider client={queryClient}>{tree}</QueryClientProvider>
    )}
  </ErrorBoundary>,
);
