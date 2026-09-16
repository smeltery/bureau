import { dialogInput, dialogLabel } from "./dialog-styles.ts";
import { useI18n } from "../../i18n.tsx";

const labelStyle: React.CSSProperties = dialogLabel;
const inputStyle: React.CSSProperties = dialogInput;
const selectStyle: React.CSSProperties = { ...inputStyle, appearance: "none", cursor: "pointer", width: "100%" };

export function EditAgentManagerField({
  canEditManager,
  managerUserId,
  managerOptions,
  setManagerUserId,
}: {
  canEditManager: boolean;
  managerUserId: string;
  managerOptions: Array<{ id: string; name: string; role: string }>;
  setManagerUserId: (id: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div style={{ marginTop: 14 }}>
      <label style={labelStyle}>{t("dialogs.agent.manager")}</label>
      {canEditManager ? (
        <select title={t("dialogs.agent.managerTitle")} value={managerUserId} onChange={(e) => setManagerUserId(e.target.value)} style={selectStyle}>
          {!managerUserId && <option value="">{t("dialogs.agent.managerUnowned")}</option>}
          {managerOptions.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
              {u.role === "owner" ? " (owner)" : ""}
            </option>
          ))}
        </select>
      ) : (
        <div
          title={t("dialogs.agent.managerTitle")}
          style={{
            ...inputStyle,
            display: "flex",
            alignItems: "center",
            color: "var(--text-muted)",
            cursor: "not-allowed",
            background: "var(--bg-elevated)",
          }}
        >
          {managerOptions.find((u) => u.id === managerUserId)?.name ?? managerUserId ?? t("dialogs.agent.managerUnowned")}
        </div>
      )}
      <p style={{ fontSize: 10, color: "var(--text-ghost)", margin: "3px 0 0" }}>{t("dialogs.agent.managerHint")}</p>
    </div>
  );
}
