import { useI18n } from "../../../i18n.tsx";
import { useState } from "react";
import { SECRET_PRESETS, type SecretMetadata } from "../../../../shared/integrations/connections.ts";
import { dialogCancelBtn, dialogHint, dialogInput, dialogLabel, dialogSaveBtn } from "../../modals/dialog-styles.ts";
import { integrationFailure, integrationFailureText, type IntegrationFailure, integrationApi } from "./api.ts";

export function SecretEditor({ path, existing, onSaved, onCancel }: { path: string; existing?: SecretMetadata; onSaved: () => void; onCancel: () => void }) {
  const { t } = useI18n();
  const [name, setName] = useState(existing?.name ?? "");
  const [value, setValue] = useState("");
  const [hosts, setHosts] = useState(existing?.hosts.join(", ") ?? "");
  const [header, setHeader] = useState(existing?.form.kind === "header" ? existing.form.header : "");
  const [note, setNote] = useState(existing?.note ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<IntegrationFailure | null>(null);
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
          setError(integrationFailure(caught, "integrations.secretSaveFailed"));
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
        {t("integrations.environmentName")}
        <input required disabled={!!existing || pending} value={name} onChange={(e) => setName(e.target.value)} style={dialogInput} placeholder="GH_TOKEN" />
      </label>
      <label style={dialogLabel}>
        {existing ? t("integrations.replacement") : t("integrations.secretValue")}
        <input type="password" autoComplete="new-password" required={!existing} value={value} onChange={(e) => setValue(e.target.value)} style={dialogInput} />
      </label>
      <label style={dialogLabel}>
        {t("integrations.hosts")}
        <input required value={hosts} onChange={(e) => setHosts(e.target.value)} style={dialogInput} placeholder="api.github.com, github.com" />
      </label>
      <p style={dialogHint}>{t("integrations.hostsHint")}</p>
      <label style={dialogLabel}>
        {t("integrations.header")}
        <input value={header} onChange={(e) => setHeader(e.target.value)} style={dialogInput} placeholder="x-api-key" />
      </label>
      <label style={dialogLabel}>
        {t("integrations.note")}
        <textarea maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} style={dialogInput} placeholder={t("integrations.notePlaceholder")} />
      </label>
      {error && <p role="alert">{integrationFailureText(error, t)}</p>}
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button disabled={pending} style={dialogSaveBtn}>
          {pending ? t("common.saving") : t("integrations.saveSecret")}
        </button>
        <button type="button" disabled={pending} style={dialogCancelBtn} onClick={onCancel}>
          {t("common.cancel")}
        </button>
      </div>
    </form>
  );
}
