import { useI18n } from "../../i18n.tsx";
import { translatorFor, type Translator } from "../../../shared/i18n/translate.ts";
import { useCallback } from "react";
import { useAppState } from "../../store.tsx";
import type { AgentInfo } from "../../../shared/types.ts";
import { buildCommitNotice, type CommitNotice } from "../../../shared/update-notice.ts";
import type { ReleaseUpdateStatus } from "../../../shared/update-types.ts";
import { CopyButton } from "../controls/CopyButton.tsx";
import { Modal } from "./Modal.tsx";

const REPO = "smeltery/bureau";
const IMAGE_GUIDES = {
  kubernetes: `https://github.com/${REPO}/blob/master/docs/contributing/hosting/kubernetes.md#update-the-office`,
  render: `https://github.com/${REPO}/blob/master/docs/contributing/hosting/render.md#update-the-office`,
  container: `https://github.com/${REPO}/blob/master/docs/contributing/hosting/reference.md#container-updates`,
} as const;

export function countBusyAgents(agents: Pick<AgentInfo, "state">[]): number {
  return agents.filter((agent) => agent.state === "thinking" || agent.state === "tool_executing").length;
}

function busyAgentRestartWarning(busyAgents: number, { tn }: Translator): string | null {
  return busyAgents > 0 ? tn("settingsUi.updateBusy", busyAgents) : null;
}

function imageCommit(status: ReleaseUpdateStatus): string | null {
  return status.apply.kind === "image" && status.current.version !== null && /^[a-f0-9]{40}$/.test(status.current.version) ? status.current.version.slice(0, 7) : null;
}

export function buildReleasePlainText(status: ReleaseUpdateStatus, { t }: Translator = translatorFor("en")): string {
  const running = status.current.release ?? (imageCommit(status) ? t("settingsUi.updateCommit", { sha: imageCommit(status)! }) : status.current.version) ?? t("settingsUi.updateUnknownVersion");
  const lines = [t(status.latest ? "settingsUi.updateNew" : "settingsUi.updateStatus"), "", `- ${t("settingsUi.updateOn", { running })}`];
  if (status.latest) {
    lines.push(
      `- ${t("settingsUi.updateLatest", { tag: status.latest.tag })}${status.latest.publishedAt ? ` (${status.latest.publishedAt})` : ""}${status.latest.url ? `: ${status.latest.url}` : ""}`,
      "",
    );
    if (status.apply.kind === "image") {
      lines.push(status.apply.guide === "render" ? t("settingsUi.updateCopyRender") : t("settingsUi.updateCopyImage", { tag: status.latest.tag }));
      lines.push(t("settingsUi.updateGuideLine", { url: IMAGE_GUIDES[status.apply.guide] }));
    } else {
      lines.push(t("settingsUi.updateCopyHost"));
    }
  }
  return lines.join("\n");
}

export function buildPlainText(notice: CommitNotice, busyAgents = 0, translator: Translator = translatorFor("en")): string {
  const { t } = translator;
  const lines = [notice.title, "", notice.notice];

  const warning = busyAgentRestartWarning(busyAgents, translator);
  if (warning) lines.push("", t("settingsUi.updateWarning", { warning }));

  lines.push(
    "",
    t("settingsUi.updateTo"),
    "",
    `1. ${t("settingsUi.updatePull")}`,
    `2. ${t("settingsUi.updateRun", { command: "`bun install`" })}`,
    `3. ${t("settingsUi.updateRestart", { dev: "`bun run dev`", user: "`systemctl --user restart bureau`", system: "`sudo systemctl restart bureau`" })}`,
  );

  return lines.join("\n");
}

function releaseTitle(status: ReleaseUpdateStatus, { t }: Translator): string {
  if (status.latest) return t("settingsUi.updateTitle", { tag: status.latest.tag });
  return t("settingsUi.updateStatus");
}

function releaseNotice(status: ReleaseUpdateStatus, { t }: Translator): string {
  const running = status.current.release ?? (imageCommit(status) ? t("settingsUi.updateCommit", { sha: imageCommit(status)! }) : status.current.version) ?? t("settingsUi.updateUnknownVersion");
  if (!status.latest) return t("settingsUi.updateRunning", { running });
  return t("settingsUi.updateBehind", { running, latest: status.latest.tag });
}

function releaseUpdateText(status: ReleaseUpdateStatus, { t }: Translator): string {
  if (!status.latest) return "";
  if (status.apply.kind !== "image") return t("settingsUi.updateHost");
  if (status.apply.guide === "render") return t("settingsUi.updateRender");
  return t("settingsUi.updateImage", { tag: status.latest.tag });
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
  const translator = useI18n();
  const { t, rich } = translator;
  const { agents, updateStatus } = useAppState();
  const busyAgents = countBusyAgents(agents);
  const warning = busyAgentRestartWarning(busyAgents, translator);
  const notice = updateStatus.mode === "commit" ? buildCommitNotice(updateStatus, translator) : null;
  const title = updateStatus.mode === "release" ? releaseTitle(updateStatus, translator) : notice?.title;
  const body = updateStatus.mode === "release" ? releaseNotice(updateStatus, translator) : notice?.notice;

  const getText = useCallback(() => {
    if (updateStatus.mode === "release") return buildReleasePlainText(updateStatus, translator);
    return notice ? buildPlainText(notice, busyAgents, translator) : "";
  }, [busyAgents, notice, updateStatus, translator]);

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
            {t("settingsUi.updateNotes")}
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
          <p style={{ ...textStyle, margin: "16px 0 6px", fontWeight: 600, color: "var(--text-primary)" }}>{t("settingsUi.updateTo")}</p>
          <ol style={{ ...textStyle, margin: 0, paddingLeft: 20 }}>
            <li>{t("settingsUi.updatePull")}</li>
            <li style={{ marginTop: 4 }}>{rich("settingsUi.updateRun", { command: <code style={code}>bun install</code> })}</li>
            <li style={{ marginTop: 4 }}>
              {rich("settingsUi.updateRestart", {
                dev: <code style={code}>bun run dev</code>,
                user: <code style={code}>systemctl --user restart bureau</code>,
                system: <code style={code}>sudo systemctl restart bureau</code>,
              })}
            </li>
          </ol>
        </>
      ) : (
        <p style={{ ...textStyle, margin: "16px 0 0" }}>
          {releaseUpdateText(updateStatus, translator)}{" "}
          {guideUrl && (
            <a href={guideUrl} target="_blank" rel="noopener noreferrer" style={{ color: "var(--blue, #58a6ff)", textDecoration: "none" }}>
              {t("settingsUi.updateGuide")}
            </a>
          )}
        </p>
      )}

      <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 14, lineHeight: 1.5, fontStyle: "italic" }}>{t("settingsUi.updateTip")}</p>

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
          {t("settingsUi.updateGotIt")}
        </button>
      </div>
    </Modal>
  );
}
