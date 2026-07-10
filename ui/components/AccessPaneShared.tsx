import { useEffect, useRef, useState } from "react";
import { dialogLabel } from "./modals/dialog-styles.ts";

export const subsectionHeader: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  margin: "16px 0 6px",
  color: "var(--text-primary)",
};

export const subLabel: React.CSSProperties = { ...dialogLabel, marginTop: 8 };

export const hint: React.CSSProperties = {
  fontSize: 11,
  color: "var(--text-ghost)",
  lineHeight: 1.4,
  margin: "4px 0",
};

export const cardStyle: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: 12,
  background: "var(--bg-input)",
  marginTop: 8,
};

export const codeBlockStyle: React.CSSProperties = {
  display: "block",
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 11,
  padding: "4px 6px",
  borderRadius: 4,
  background: "var(--bg-input)",
  color: "var(--text-primary)",
  margin: "4px 0",
};

export const restartBoxStyle: React.CSSProperties = {
  marginTop: 12,
  padding: 10,
  border: "1px solid var(--accent)",
  borderRadius: 6,
  background: "var(--bg-hover)",
};

// Surfaces the freshly-minted invite URL with a working copy button and
// visible feedback. Falls back to a hidden-textarea + execCommand path
// when navigator.clipboard rejects; final fallback selects the URL so the
// user can copy manually.
export function MintedUrlBox({ url }: { url: string }) {
  const codeRef = useRef<HTMLElement | null>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "ok" | "fallback" | "fail">("idle");

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    };
  }, []);

  function flashFeedback(next: "ok" | "fallback") {
    setCopyState(next);
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = setTimeout(() => {
      feedbackTimerRef.current = null;
      setCopyState("idle");
    }, 1500);
  }

  async function handleCopy() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        flashFeedback("ok");
        return;
      }
    } catch {}
    const ta = document.createElement("textarea");
    ta.value = url;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    try {
      ta.select();
      const ok = document.execCommand("copy");
      if (ok) {
        flashFeedback("fallback");
        return;
      }
    } catch {
    } finally {
      document.body.removeChild(ta);
    }
    const node = codeRef.current;
    if (node) {
      const range = document.createRange();
      range.selectNodeContents(node);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
    setCopyState("fail");
  }

  return (
    <div style={mintedBox}>
      <div style={{ ...subLabel, marginTop: 0 }}>Invite URL</div>
      <code ref={codeRef} style={codeStyle}>
        {url}
      </code>
      <button
        onClick={() => {
          void handleCopy();
        }}
        style={smallBtn}
        title="Copy URL"
      >
        {copyState === "ok" || copyState === "fallback" ? "Copied!" : "Copy"}
      </button>
      {copyState === "fail" && <p style={{ ...hint, color: "#ff6b6b", marginTop: 4 }}>Clipboard blocked. The URL above is selected — copy it manually.</p>}
      <p style={hint}>Send this URL to the invitee. It's one-time: opening it on their device signs them in. The URL is shown once — copy it now.</p>
    </div>
  );
}

const smallBtn: React.CSSProperties = {
  padding: "3px 8px",
  fontSize: 11,
  borderRadius: 4,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--text-dim)",
  cursor: "pointer",
};

const mintedBox: React.CSSProperties = {
  marginTop: 12,
  padding: 10,
  border: "1px solid var(--accent)",
  borderRadius: 6,
  background: "var(--bg-hover)",
};

const codeStyle: React.CSSProperties = {
  display: "block",
  wordBreak: "break-all",
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 11,
  margin: "4px 0",
  color: "var(--text-primary)",
};
