import { useCallback } from "react";
import { useAppState } from "../../store.tsx";
import type { AgentInfo } from "../../../shared/types.ts";
import { buildCommitNotice, type CommitNotice } from "../../../shared/update-notice.ts";
import type { ReleaseUpdateStatus, UpdateStatusWire } from "../../../shared/update-types.ts";
import { CopyButton } from "../controls/CopyButton.tsx";
import { Modal } from "./Modal.tsx";

const REPO = "smeltery/bureau";
const IMAGE_GUIDES = {
  kubernetes: "https://github.com/dotbrains/bureau/blob/master/docs/contributing/hosting/kubernetes.md#update-the-office",
  render: "https://github.com/dotbrains/bureau/blob/master/docs/contributing/hosting/render.md",
  container: "https://github.com/dotbrains/bureau/blob/master/deploy/container/reference.md#updates",
} as const;

export function countBusyAgents(agents: Pick<AgentInfo, "state">[]): number {
  return agents.filter((agent) => agent.state === "thinking" || agent.state === "tool_executing").length;
}

function busyAgentRestartWarning(busyAgents: number): string | null {
  if (busyAgents === 0) return null;
  return `${busyAgents} ${busyAgents === 1 ? "agent is" : "agents are"} currently working. Wait for ${busyAgents === 1 ? "it" : "them"} to finish before restarting if you do not want to interrupt active work.`;
}

function imageCommit(status: ReleaseUpdateStatus): string | null {
  return status.apply.kind === "image" && status.current.version !== null && /^[a-f0-9]{40}$/.test(status.current.version) ? status.current.version.slice(0, 7) : null;
}

export function buildReleasePlainText(status: ReleaseUpdateStatus): string {
  const running = status.current.release ?? (imageCommit(status) ? `commit ${imageCommit(status)}` : status.current.version) ?? "an unknown version";
  const lines = ["New Release Available", "", `- You are on ${running}`];
  if (status.latest) {
    lines.push(`- Latest release: ${status.latest.tag}${status.latest.publishedAt ? ` (${status.latest.publishedAt})` : ""}${status.latest.url ? `: ${status.latest.url}` : ""}`, "");
    if (status.apply.kind === "image") {
      lines.push(status.apply.guide === "render" ? "To update: use the web service's manual deployment control in Render." : `To update: deploy the ${status.latest.tag} release image.`);
      lines.push(`Guide: ${IMAGE_GUIDES[status.apply.guide]}`);
    } else {
      lines.push("To update: use the update button in the office, or update the host service manually.");
    }
  }
  return lines.join("\n");
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
    "3. Restart the server: run `bun run dev`; for a user service run `systemctl --user restart bureau`; for a system service run `sudo systemctl restart bureau`.",
  );

  return lines.join("\n");
}

function releaseTitle(status: ReleaseUpdateStatus): string {
  if (status.latest) return `New Release Available: ${status.latest.tag}`;
  return "Release Status";
}

function releaseNotice(status: ReleaseUpdateStatus): string {
  const running = status.current.release ?? (imageCommit(status) ? `commit ${imageCommit(status)}` : status.current.version) ?? "an unknown version";
  if (!status.latest) return `You're on ${running}.`;
  return `You're on ${running}; ${status.latest.tag} is out.`;
}

function releaseUpdateText(status: ReleaseUpdateStatus): string {
  if (!status.latest) return "";
  if (status.apply.kind !== "image") return "Use the office update control, or update the host service manually.";
  if (status.apply.guide === "render") return "Use Render's manual deployment control.";
  return `Deploy the ${status.latest.tag} release image.`;
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
  const notice = updateStatus.mode === "commit" ? buildCommitNotice(updateStatus) : null;
  const title = updateStatus.mode === "release" ? releaseTitle(updateStatus) : notice?.title;
  const body = updateStatus.mode === "release" ? releaseNotice(updateStatus) : notice?.notice;

  const getText = useCallback(() => {
    if (updateStatus.mode === "release") return buildReleasePlainText(updateStatus);
    return notice ? buildPlainText(notice, busyAgents) : "";
  }, [busyAgents, notice, updateStatus]);

  if (!title || !body) return null;
  const releaseUrl = updateStatus.latest?.url;
  const guideUrl = updateStatus.mode === "release" && updateStatus.apply.kind === "image" ? IMAGE_GUIDES[updateStatus.apply.guide] : null;

  return (
    <Modal onClose={onClose} width={480}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h3 style={{ fontSize: 17, fontWeight: 700, margin: 0, color: "var(--text-primary)" }}>{title}</h3>
        <CopyButton getText={getText} size={28} />
      </div>

      <p style={{ ...textStyle, margin: "16px 0 0" }}>
        {body}{" "}
        {releaseUrl ? (
          <a href={releaseUrl} target="_blank" rel="noopener noreferrer" style={{ color: "var(--blue, #58a6ff)", textDecoration: "none" }}>
            (release notes)
          </a>
        ) : (
          <a href={`https://github.com/${REPO}`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--blue, #58a6ff)", textDecoration: "none" }}>
            (GitHub)
          </a>
        )}
      </p>

      {warning && updateStatus.mode === "commit" && (
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

      {updateStatus.mode === "commit" ? (
        <>
          <p style={{ ...textStyle, margin: "16px 0 6px", fontWeight: 600, color: "var(--text-primary)" }}>To update:</p>
          <ol style={{ ...textStyle, margin: 0, paddingLeft: 20 }}>
            <li>Pull the latest changes</li>
            <li style={{ marginTop: 4 }}>
              Run <code style={code}>bun install</code>
            </li>
            <li style={{ marginTop: 4 }}>
              Restart the server: run <code style={code}>bun run dev</code>; for a user service run <code style={code}>systemctl --user restart bureau</code>; for a system service run{" "}
              <code style={code}>sudo systemctl restart bureau</code>.
            </li>
          </ol>
        </>
      ) : (
        <p style={{ ...textStyle, margin: "16px 0 0" }}>
          {releaseUpdateText(updateStatus)}{" "}
          {guideUrl && (
            <a href={guideUrl} target="_blank" rel="noopener noreferrer" style={{ color: "var(--blue, #58a6ff)", textDecoration: "none" }}>
              Update guide
            </a>
          )}
        </p>
      )}

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
