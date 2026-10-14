import { useState } from "react";
import { dialogCancelBtn, dialogHint, dialogInput, dialogLabel, dialogSaveBtn } from "../../modals/dialog-styles.ts";
import { integrationApi, type IntegrationListing } from "./api.ts";
export function VariablesPane({ path, data, reload }: { path: string; data: IntegrationListing; reload: () => void }) {
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
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
      setError(caught instanceof Error ? caught.message : "Could not save the variable.");
    } finally {
      setPending(false);
    }
  }
  return (
    <div>
      <p style={dialogHint}>Variables are ordinary environment values visible to agents. Store integration credentials in Secrets instead. Updates take effect between turns.</p>
      {error && <p role="alert">{error}</p>}
      {data.canManage && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save("PUT");
          }}
        >
          <label style={dialogLabel}>
            Name
            <input required pattern="[A-Za-z_][A-Za-z0-9_]*" style={dialogInput} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label style={dialogLabel}>
            Value
            <input style={dialogInput} value={value} onChange={(e) => setValue(e.target.value)} />
          </label>
          <button disabled={pending} style={dialogSaveBtn}>
            {pending ? "Saving…" : "Save variable"}
          </button>
        </form>
      )}
      {!data.variables.length && <p style={dialogHint}>No variables in this scope.</p>}
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
                Edit
              </button>
              <button disabled={pending} style={dialogCancelBtn} onClick={() => void save("DELETE", variable.name)}>
                Delete
              </button>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
