import { useCallback } from "react";
import { useAppState } from "../../store.tsx";
import { CopyButton } from "../controls/CopyButton.tsx";
import { Modal } from "./Modal.tsx";

const REPO = "dotbrains/bureau";

function shortSha(sha: string) {
  return sha.slice(0, 7);
}

function formatDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function buildPlainText(current: { sha: string; message: string; date: string }, latest: { sha: string; message: string; date: string }): string {
  return [
    "Update Available",
    "",
    `- You are on commit ${shortSha(current.sha)}: ${current.message} (${formatDate(current.date)})`,
    `- GitHub is on commit ${shortSha(latest.sha)}: ${latest.message} (${formatDate(latest.date)})`,
    "",
    "To update:",
    "",
    "1. Pull the latest changes",
    "2. Run `bun install`",
    `3. Restart the server: run \`bun run dev\`, or something like \`systemctl --user restart bureau\` if using a persistent systemd service.`,
  ].join("\n");
}

const code: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 12,
  color: "var(--text-primary)",
};

const textStyle: React.CSSProperties = {
  fontSize: 13,
  color: "var(--text-dim)",
  lineHeight: 1.6,
};

export function UpdateModal({ onClose }: { onClose: () => void }) {
  const { updateCurrent, updateLatest } = useAppState();

  const getText = useCallback(() => buildPlainText(updateCurrent, updateLatest), [updateCurrent, updateLatest]);

  return (
    <Modal onClose={onClose} width={480}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h3 style={{ fontSize: 17, fontWeight: 700, margin: 0, color: "var(--text-primary)" }}>Update Available</h3>
        <CopyButton getText={getText} size={28} />
      </div>

      <ul style={{ ...textStyle, margin: "16px 0 0", paddingLeft: 20 }}>
        <li>
          You are on commit <code style={code}>{shortSha(updateCurrent.sha)}</code>: {updateCurrent.message} ({formatDate(updateCurrent.date)})
        </li>
        <li style={{ marginTop: 4 }}>
          <a href={`https://github.com/${REPO}`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--blue, #58a6ff)", textDecoration: "none" }}>
            GitHub
          </a>{" "}
          is on commit <code style={code}>{shortSha(updateLatest.sha)}</code>: {updateLatest.message} ({formatDate(updateLatest.date)})
        </li>
      </ul>

      <p style={{ ...textStyle, margin: "16px 0 6px", fontWeight: 600, color: "var(--text-primary)" }}>To update:</p>
      <ol style={{ ...textStyle, margin: 0, paddingLeft: 20 }}>
        <li>Pull the latest changes</li>
        <li style={{ marginTop: 4 }}>
          Run <code style={code}>bun install</code>
        </li>
        <li style={{ marginTop: 4 }}>
          Restart the server: run <code style={code}>bun run dev</code>, or something like <code style={code}>systemctl --user restart bureau</code> if using a persistent systemd service.
        </li>
      </ol>

      <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 14, lineHeight: 1.5, fontStyle: "italic" }}>
        Tip: click the copy button to copy this notice to clipboard, then ask any agent to take care of it.
      </p>

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 20 }}>
        <button
          onClick={onClose}
          style={{
            padding: "7px 16px",
            borderRadius: 8,
            border: "none",
            background: "var(--accent)",
            color: "var(--bg-base)",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Got it
        </button>
      </div>
    </Modal>
  );
}
