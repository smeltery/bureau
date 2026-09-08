import { ManagedEnvEditor } from "./modals/ManagedEnvEditor.tsx";
import { sectionHeader } from "./AccessPane.tsx";
import { useI18n } from "../i18n.tsx";

export function OfficeVariablesPane() {
  const { t } = useI18n();
  return (
    <div style={{ marginTop: 24 }}>
      <h4 style={sectionHeader}>{t("variables.office.title")}</h4>
      <p style={{ fontSize: 11, margin: "5px 0 12px", color: "var(--text-ghost)" }}>{t("variables.office.intro")}</p>
      <ManagedEnvEditor path="/api/office/env" />
    </div>
  );
}
