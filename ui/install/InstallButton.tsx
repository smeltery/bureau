import { useState, useSyncExternalStore } from "react";
import { installController, isAppleMobile, isStandalone } from "./controller.ts";
const subscribe = (listener: () => void) => installController?.subscribe(listener) ?? (() => {});
const snapshot = () => installController?.snapshot() ?? "unavailable";

export function InstallButton({ name = "Bureau", showInstructions = false }: { name?: string; showInstructions?: boolean }) {
  const status = useSyncExternalStore(subscribe, snapshot, () => "unavailable");
  const [instructions, setInstructions] = useState(showInstructions);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (status === "installed" || (isStandalone() && !showInstructions)) return null;
  async function install() {
    setError("");
    if (status !== "ready") {
      setInstructions(!instructions);
      return;
    }
    setBusy(true);
    try {
      const outcome = await installController?.install();
      if (outcome === "dismissed") setError("Installation was dismissed. You can try again from the browser menu.");
    } catch {
      setError("The browser could not open the install prompt. Try its install menu instead.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <span style={{ display: "inline-block", position: "relative" }}>
      <button
        style={{ padding: "5px 8px", background: "var(--bg-surface)", color: "var(--text-primary)", border: "1px solid var(--border-subtle)", borderRadius: 5, cursor: "pointer" }}
        onClick={() => void install()}
        disabled={busy}
        aria-expanded={instructions}
      >
        {busy ? "Opening install…" : `Install ${name}`}
      </button>
      {instructions && (
        <span
          role="note"
          style={{
            display: "block",
            position: "absolute",
            top: "100%",
            right: 0,
            width: 260,
            maxWidth: "85vw",
            zIndex: 1100,
            padding: 8,
            fontSize: 12,
            background: "var(--bg-surface)",
            color: "var(--text-primary)",
          }}
        >
          {isAppleMobile()
            ? "Open this page in Safari, tap Share, then Add to Home Screen and confirm Add."
            : "Use your browser’s Install app, Add to Home Screen or Add to Dock menu. If no install option is available, open this page in a supported browser over HTTPS."}
          {isAppleMobile() && (
            <input
              aria-label="Install page address"
              readOnly
              value={window.location.origin + window.location.pathname}
              onFocus={(event) => event.target.select()}
              style={{ width: "100%", marginTop: 8 }}
            />
          )}
          {status === "ready" && " The Install button can now open your browser’s prompt."}
        </span>
      )}
      {error && (
        <span role="status" style={{ display: "block", maxWidth: 320, fontSize: 12 }}>
          {error}
        </span>
      )}
    </span>
  );
}
