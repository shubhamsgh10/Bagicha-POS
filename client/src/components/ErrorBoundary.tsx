import { Component, type ErrorInfo, type ReactNode } from "react";
import * as Sentry from "@sentry/react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Catches render-phase throws that would otherwise unmount the whole app to a blank
 * white screen (there was no ErrorBoundary anywhere in client/src before this). Only
 * catches render/lifecycle errors, not event handlers or async code — see main.tsx's
 * window.onerror/unhandledrejection for those.
 *
 * Styled with inline styles, not the design-system's CSS custom properties — this UI
 * must render even if the crash was caused by something upstream of those variables.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
    Sentry.captureException(error, { extra: { componentStack: info.componentStack ?? undefined } });
  }

  private handleReload = () => {
    // A render-phase throw usually means some in-memory state is corrupted — a full
    // reload is the safe recovery, not just clearing this boundary's local state.
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: "100vh",
            padding: 24,
            textAlign: "center",
            gap: 12,
            fontFamily: "system-ui, -apple-system, sans-serif",
            background: "#f8fafc",
            color: "#111",
          }}
        >
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Something went wrong</h1>
          <p style={{ color: "#666", maxWidth: 360, margin: 0 }}>
            The app hit an unexpected error. Reloading usually fixes it.
          </p>
          <button
            onClick={this.handleReload}
            style={{
              padding: "10px 20px",
              borderRadius: 8,
              border: "none",
              background: "#111",
              color: "#fff",
              fontWeight: 600,
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
