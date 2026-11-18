import { Component, type ErrorInfo, type ReactNode } from "react";
import * as Sentry from "@sentry/react";
import { clearPersistedCache } from "@/lib/queryPersistence";
import { reportClientError } from "@/lib/errorReporter";
import type { ClientErrorReport } from "@shared/clientErrorReport";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  componentStack: string | null;
  report: ClientErrorReport | null;
  showDetails: boolean;
  copied: boolean;
}

/**
 * Catches render-phase throws that would otherwise unmount the whole app to a blank
 * white screen (there was no ErrorBoundary anywhere in client/src before this). Only
 * catches render/lifecycle errors, not event handlers or async code — see main.tsx's
 * window.onerror/unhandledrejection for those.
 *
 * Every crash is reported (lib/errorReporter.ts: server log + `client.error` audit row, and the
 * desktop log file) and its details are shown here behind "Show details", with an error id that
 * matches the logged report — so a crash can be diagnosed from the record, or from a photo of this
 * screen, instead of guessed at (17 Nov 2026).
 *
 * Styled with inline styles, not the design-system's CSS custom properties — this UI
 * must render even if the crash was caused by something upstream of those variables.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, componentStack: null, report: null, showDetails: false, copied: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
    Sentry.captureException(error, { extra: { componentStack: info.componentStack ?? undefined } });
    const report = reportClientError("render", error, { componentStack: info.componentStack ?? null });
    this.setState({ componentStack: info.componentStack ?? null, report });
  }

  private handleReload = async () => {
    // A render-phase throw usually means some in-memory state is corrupted — a full
    // reload is the safe recovery, not just clearing this boundary's local state.
    // Desktop app: also drop the saved screen data (IndexedDB), or a bad saved copy is restored
    // on the reload and the same screen crashes again, forever (17 Nov 2026 crash loop).
    try { await clearPersistedCache(); } catch { /* never block the reload */ }
    window.location.reload();
  };

  private detailsText(): string {
    const { error, componentStack, report } = this.state;
    const lines = [
      `Error id: ${report?.errorId ?? "-"}`,
      `Time: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`,
      `Screen: ${report?.route ?? window.location.hash ?? window.location.pathname}`,
      `App: ${report?.electron ? `desktop ${report?.appVersion ?? ""}` : "browser"}`,
      `Signed in: ${report?.signedIn == null ? "unknown" : report.signedIn ? "yes" : "no"}`,
      "",
      `${error?.name ?? "Error"}: ${error?.message ?? "unknown"}`,
      (error?.stack ?? "").split("\n").slice(1, 9).join("\n"),
    ];
    const failed = (report?.requests ?? []).filter((r) => r.s === null || r.s >= 400).slice(-5);
    if (failed.length) {
      lines.push("", "Recent failed requests:");
      for (const r of failed) lines.push(`  ${r.m} ${r.p} -> ${r.s ?? (r.to ? "timeout" : "no response")} (${r.ago}s ago)`);
    }
    if (componentStack) lines.push("", "Component:", componentStack.trim().split("\n").slice(0, 6).join("\n"));
    return lines.join("\n");
  }

  private handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(this.detailsText());
      this.setState({ copied: true });
    } catch { /* clipboard blocked: the text is on screen anyway */ }
  };

  render() {
    if (this.state.hasError) {
      const { error, report, showDetails, copied } = this.state;
      const button = (primary: boolean) => ({
        padding: "10px 20px",
        borderRadius: 8,
        border: primary ? "none" : "1px solid #cbd5e1",
        background: primary ? "#111" : "#fff",
        color: primary ? "#fff" : "#111",
        fontWeight: 600,
        fontSize: 14,
        cursor: "pointer",
      });
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "100vh",
            padding: 24,
            textAlign: "center",
            gap: 12,
            fontFamily: "system-ui, -apple-system, sans-serif",
            background: "#f8fafc",
            color: "#111",
            boxSizing: "border-box",
          }}
        >
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Something went wrong</h1>
          <p style={{ color: "#666", maxWidth: 380, margin: 0 }}>
            The app hit an unexpected error. Reloading usually fixes it. The error was recorded
            {report ? <> as <b style={{ fontFamily: "monospace", color: "#111" }}>{report.errorId}</b></> : null}.
          </p>
          <p style={{ color: "#b91c1c", maxWidth: 460, margin: 0, fontSize: 13, fontFamily: "monospace", wordBreak: "break-word" }}>
            {error?.name ?? "Error"}: {error?.message ?? "unknown"}
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
            <button onClick={this.handleReload} style={button(true)}>Reload</button>
            <button onClick={() => this.setState({ showDetails: !showDetails })} style={button(false)}>
              {showDetails ? "Hide details" : "Show details"}
            </button>
            {showDetails && (
              <button onClick={this.handleCopy} style={button(false)}>{copied ? "Copied" : "Copy details"}</button>
            )}
          </div>
          {showDetails && (
            <pre
              style={{
                textAlign: "left",
                maxWidth: "min(720px, 100%)",
                width: "100%",
                maxHeight: "45vh",
                overflow: "auto",
                background: "#0f172a",
                color: "#e2e8f0",
                padding: 12,
                borderRadius: 8,
                fontSize: 11,
                lineHeight: 1.45,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                margin: 0,
                boxSizing: "border-box",
              }}
            >
              {this.detailsText()}
            </pre>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}
