import { useState } from "react";
import { SECRET_PRESETS, type SecretMetadata } from "../../../../shared/integrations/connections.ts";
import { dialogCancelBtn, dialogHint, dialogInput, dialogLabel, dialogSaveBtn } from "../../modals/dialog-styles.ts";
import { integrationApi } from "./api.ts";

export function SecretEditor({ path, existing, onSaved, onCancel }: { path: string; existing?: SecretMetadata; onSaved: () => void; onCancel: () => void }) {
  const [name, setName] = useState(existing?.name ?? "");
  const [value, setValue] = useState("");
  const [hosts, setHosts] = useState(existing?.hosts.join(", ") ?? "");
  const [header, setHeader] = useState(existing?.form.kind === "header" ? existing.form.header : "");
  const [note, setNote] = useState(existing?.note ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        setPending(true);
        setError(null);
        try {
          await integrationApi(`${path}/secrets/${encodeURIComponent(name)}`, "PUT", {
            ...(value ? { value } : {}),
            hosts: hosts
              .split(",")
              .map((host) => host.trim())
              .filter(Boolean),
            form: header ? { kind: "header", header } : { kind: "authorization" },
            note,
          });
          setValue("");
          onSaved();
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : "Could not save the credential.");
        } finally {
          setPending(false);
        }
      }}
    >
      {!existing && (
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          {SECRET_PRESETS.map((preset) => (
            <button
              type="button"
              key={preset.name}
              style={dialogCancelBtn}
              onClick={() => {
                setName(preset.name);
                setHosts(preset.hosts.join(", "));
                setHeader("");
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>
      )}
      <label style={dialogLabel}>
        Environment name
        <input required disabled={!!existing || pending} value={name} onChange={(e) => setName(e.target.value)} style={dialogInput} placeholder="GH_TOKEN" />
      </label>
      <label style={dialogLabel}>
        {existing ? "Replacement value (leave empty to keep)" : "Secret value"}
        <input type="password" autoComplete="new-password" required={!existing} value={value} onChange={(e) => setValue(e.target.value)} style={dialogInput} />
      </label>
      <label style={dialogLabel}>
        Allowed hosts, separated by commas
        <input required value={hosts} onChange={(e) => setHosts(e.target.value)} style={dialogInput} placeholder="api.github.com, github.com" />
      </label>
      <p style={dialogHint}>Use exact hostnames. Credentials are delivered only over HTTPS port 443 to these hosts. Model providers and package registries are excluded.</p>
      <label style={dialogLabel}>
        Custom header (empty for Authorization)
        <input value={header} onChange={(e) => setHeader(e.target.value)} style={dialogInput} placeholder="x-api-key" />
      </label>
      <label style={dialogLabel}>
        Usage note for agents
        <textarea maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} style={dialogInput} placeholder="What this connection is for; never paste credentials here." />
      </label>
      {error && <p role="alert">{error}</p>}
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button disabled={pending} style={dialogSaveBtn}>
          {pending ? "Saving…" : "Save secret"}
        </button>
        <button type="button" disabled={pending} style={dialogCancelBtn} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
