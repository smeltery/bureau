import { ManagedEnvEditor } from "./modals/ManagedEnvEditor.tsx";
import { sectionHeader } from "./AccessPane.tsx";
import { useI18n } from "../i18n.tsx";

/** First-class Account sidebar entry for the signed-in user's managed env. */
export function PersonalVariablesPane({ username }: { username: string }) {
  const { t } = useI18n();
  return (
    <div style={{ marginTop: 24 }}>
      <h4 style={sectionHeader}>{t("variables.personal.title")}</h4>
      <p style={{ fontSize: 11, margin: "5px 0 12px", color: "var(--text-ghost)" }}>{t("variables.personal.intro")}</p>
      <ManagedEnvEditor path={`/api/users/${encodeURIComponent(username)}/env`} />
    </div>
  );
}
