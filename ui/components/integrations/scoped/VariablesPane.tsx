import { useI18n } from "../../../i18n.tsx";
import { useState } from "react";
import { dialogCancelBtn, dialogHint, dialogInput, dialogLabel, dialogSaveBtn } from "../../modals/dialog-styles.ts";
import { integrationFailure, integrationFailureText, type IntegrationFailure, integrationApi, type IntegrationListing } from "./api.ts";
export function VariablesPane({ path, data, reload }: { path: string; data: IntegrationListing; reload: () => void }) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [error, setError] = useState<IntegrationFailure | null>(null);
  const [pending, setPending] = useState(false);
  async function save(method: string, selected = name) {
    setPending(true);
    setError(null);
    try {
      await integrationApi(`${path}/variables/${encodeURIComponent(selected)}`, method, method === "PUT" ? { value } : undefined);
      setName("");
      setValue("");
      reload();
    } catch (caught) {
      setError(integrationFailure(caught, "integrations.variableSaveFailed"));
    } finally {
      setPending(false);
    }
  }
  return (
    <div>
      <p style={dialogHint}>{t("integrations.variableHint")}</p>
      {error && <p role="alert">{integrationFailureText(error, t)}</p>}
      {data.canManage && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save("PUT");
          }}
        >
          <label style={dialogLabel}>
            {t("common.name")}
            <input required pattern="[A-Za-z_][A-Za-z0-9_]*" style={dialogInput} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label style={dialogLabel}>
            {t("integrations.value")}
            <input style={dialogInput} value={value} onChange={(e) => setValue(e.target.value)} />
          </label>
          <button disabled={pending} style={dialogSaveBtn}>
            {pending ? t("common.saving") : t("integrations.saveVariable")}
          </button>
        </form>
      )}
      {!data.variables.length && <p style={dialogHint}>{t("integrations.noVariables")}</p>}
      {data.variables.map((variable) => (
        <div key={variable.name} style={{ borderTop: "1px solid var(--border-subtle)", marginTop: 12, paddingTop: 12 }}>
          <strong>{variable.name}</strong>
          {variable.value !== undefined && <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{variable.value}</pre>}
          {data.canManage && (
            <>
              <button
                disabled={pending}
                style={dialogCancelBtn}
                onClick={() => {
                  setName(variable.name);
                  setValue(variable.value ?? "");
                }}
              >
                {t("common.edit")}
              </button>
              <button disabled={pending} style={dialogCancelBtn} onClick={() => void save("DELETE", variable.name)}>
                {t("common.delete")}
              </button>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
