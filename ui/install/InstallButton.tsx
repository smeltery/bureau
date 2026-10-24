import { createPortal } from "react-dom";
import { useI18n } from "../i18n.tsx";
import type { PlainMessageKey } from "../../shared/i18n/translate.ts";
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { installController, isAppleMobile, isStandalone } from "./controller.ts";
const subscribe = (listener: () => void) => installController?.subscribe(listener) ?? (() => {});
const snapshot = () => installController?.snapshot() ?? "unavailable";

export function InstallButton({ name = "Bureau", showInstructions = false }: { name?: string; showInstructions?: boolean }) {
  const { t, language } = useI18n();
  const status = useSyncExternalStore(subscribe, snapshot, () => "unavailable");
  const [instructions, setInstructions] = useState(showInstructions);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<PlainMessageKey | null>(null);
  const anchor = useRef<HTMLSpanElement>(null);
  const note = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  useLayoutEffect(() => {
    if (!instructions || !anchor.current || !note.current) return;
    const place = () => {
      if (!anchor.current || !note.current) return;
      const rect = anchor.current.getBoundingClientRect();
      const popup = note.current.getBoundingClientRect();
      setPosition({
        left: Math.max(8, Math.min(rect.right - popup.width, window.innerWidth - popup.width - 8)),
        top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - popup.height - 8)),
      });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(anchor.current);
    observer.observe(note.current);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [instructions, language, status, busy]);
  if (status === "installed" || (isStandalone() && !showInstructions)) return null;
  async function install() {
    setError(null);
    if (status !== "ready") {
      setInstructions(!instructions);
      return;
    }
    setBusy(true);
    try {
      const outcome = await installController?.install();
      if (outcome === "dismissed") setError("appsUi.installDismissed");
    } catch {
      setError("appsUi.installFailed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <span ref={anchor} style={{ display: "inline-block", position: "relative" }}>
      <button
        style={{ padding: "5px 8px", background: "var(--bg-surface)", color: "var(--text-primary)", border: "1px solid var(--border-subtle)", borderRadius: 5, cursor: "pointer" }}
        onClick={() => void install()}
        disabled={busy}
        aria-expanded={instructions}
      >
        {busy ? t("appsUi.installOpening") : t("appsUi.installNamed", { name })}
      </button>
      {instructions &&
        createPortal(
          <span
            ref={note}
            role="note"
            style={{
              display: "block",
              position: "fixed",
              ...position,
              width: 260,
              maxWidth: "calc(100vw - 16px)",
              maxHeight: "calc(100dvh - 16px)",
              overflowY: "auto",
              zIndex: 1100,
              padding: 8,
              fontSize: 12,
              background: "var(--bg-surface)",
              color: "var(--text-primary)",
            }}
          >
            {isAppleMobile() ? t("appsUi.installApple") : t("appsUi.installMenu")}
            {isAppleMobile() && (
              <input
                aria-label={t("appsUi.installAddress")}
                readOnly
                value={window.location.origin + window.location.pathname}
                onFocus={(event) => event.target.select()}
                style={{ width: "100%", marginTop: 8 }}
              />
            )}
            {status === "ready" && ` ${t("appsUi.installReady")}`}
          </span>,
          document.body,
        )}
      {error && (
        <span role="status" style={{ display: "block", maxWidth: 320, fontSize: 12 }}>
          {t(error)}
        </span>
      )}
    </span>
  );
}
