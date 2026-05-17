import { StrictMode, Component, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { Router } from "wouter";
import "./styles.css";
import App from "./app.tsx";

class ErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null };
  static getDerivedStateFromError(e: Error) { return { error: e.message + "\n" + e.stack }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 32, fontFamily: "monospace", fontSize: 13, background: "#fff1f0", border: "1px solid #fca5a5", borderRadius: 8, margin: 24 }}>
          <strong style={{ color: "#dc2626" }}>App failed to render</strong>
          <pre style={{ marginTop: 12, whiteSpace: "pre-wrap", color: "#7f1d1d" }}>{this.state.error}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <Router>
        <App />
      </Router>
    </ErrorBoundary>
  </StrictMode>
);
