import { useCallback } from "react";
import { useAppState } from "../../store.tsx";
import type { AgentInfo } from "../../../shared/types.ts";
import { buildCommitNotice, type CommitNotice } from "../../../shared/update-notice.ts";
import { CopyButton } from "../controls/CopyButton.tsx";
import { Modal } from "./Modal.tsx";

const REPO = "dotbrains/bureau";

export function countBusyAgents(agents: Pick<AgentInfo, "state">[]): number {
  return agents.filter((agent) => agent.state === "thinking" || agent.state === "tool_executing").length;
}

function busyAgentRestartWarning(busyAgents: number): string | null {
  if (busyAgents === 0) return null;
  return `${busyAgents} ${busyAgents === 1 ? "agent is" : "agents are"} currently working. Wait for ${busyAgents === 1 ? "it" : "them"} to finish before restarting if you do not want to interrupt active work.`;
}

export function buildPlainText(notice: CommitNotice, busyAgents = 0): string {
  const lines = [notice.title, "", notice.notice];

  const warning = busyAgentRestartWarning(busyAgents);
  if (warning) lines.push("", `Warning: ${warning}`);

  lines.push(
    "",
    "To update:",
    "",
    "1. Pull the latest changes",
    "2. Run `bun install`",
    `3. Restart the server: run \`bun run dev\`, or something like \`systemctl --user restart bureau\` if using a persistent systemd service.`,
  );

  return lines.join("\n");
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
  const { agents, updateStatus } = useAppState();
  const busyAgents = countBusyAgents(agents);
  const warning = busyAgentRestartWarning(busyAgents);
  const notice = buildCommitNotice(updateStatus);

  const getText = useCallback(() => (notice ? buildPlainText(notice, busyAgents) : ""), [busyAgents, notice]);

  if (!notice) return null;

  return (
    <Modal onClose={onClose} width={480}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h3 style={{ fontSize: 17, fontWeight: 700, margin: 0, color: "var(--text-primary)" }}>{notice.title}</h3>
        <CopyButton getText={getText} size={28} />
      </div>

      <p style={{ ...textStyle, margin: "16px 0 0" }}>
        {notice.notice}{" "}
        {updateStatus.latest?.url ? (
          <a href={updateStatus.latest.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--blue, #58a6ff)", textDecoration: "none" }}>
            (release notes)
          </a>
        ) : (
          <a href={`https://github.com/${REPO}`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--blue, #58a6ff)", textDecoration: "none" }}>
            (GitHub)
          </a>
        )}
      </p>

      {warning && (
        <p
          style={{
            ...textStyle,
            margin: "16px 0 0",
            padding: "10px 12px",
            border: "1px solid var(--orange, #d29922)",
            borderRadius: 8,
            background: "color-mix(in srgb, var(--orange, #d29922) 12%, transparent)",
            color: "var(--text-primary)",
          }}
        >
          {warning}
        </p>
      )}

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
