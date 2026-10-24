import { useI18n } from "../../../i18n.tsx";
import { settingsFailureText, type SettingsFailure } from "../../../hooks/settings/feedback.ts";
export type ValidationStatus = { kind: "idle" } | { kind: "pending" } | { kind: "ok"; keyCount?: number } | { kind: "error"; message: SettingsFailure };

export function ValidationLine({ status }: { status: ValidationStatus }) {
  const { t, tn } = useI18n();
  if (status.kind === "idle") return null;
  if (status.kind === "pending") {
    return <p style={{ fontSize: 10, color: "var(--text-ghost)", margin: "4px 0 0" }}>{t("settings.profile.checking")}</p>;
  }
  if (status.kind === "ok") {
    return <p style={{ fontSize: 10, color: "var(--accent)", margin: "4px 0 0" }}>{tn("settings.profile.loadedVariables", status.keyCount ?? 0)}</p>;
  }
  return <p style={{ fontSize: 10, color: "#ff6b6b", margin: "4px 0 0" }}>{settingsFailureText(status.message, t)}</p>;
}
