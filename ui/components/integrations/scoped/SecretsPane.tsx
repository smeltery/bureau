import { useI18n } from "../../../i18n.tsx";
import { ConnectionTest } from "./ConnectionTest.tsx";
import { useState } from "react";
import type { SecretMetadata } from "../../../../shared/integrations/connections.ts";
import { dialogCancelBtn, dialogHint, dialogSaveBtn } from "../../modals/dialog-styles.ts";
import { integrationFailure, integrationFailureText, type IntegrationFailure, integrationApi, type IntegrationListing } from "./api.ts";
import { SecretEditor } from "./SecretEditor.tsx";

export function SecretsPane({ path, data, reload }: { path: string; data: IntegrationListing; reload: () => void }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState<SecretMetadata | "new" | null>(null);
  const [revealed, setRevealed] = useState<{ name: string; value: string } | null>(null);
  const [confirmation, setConfirmation] = useState<{ name: string; action: "delete" | "reissue" } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<IntegrationFailure | null>(null);
  async function action(run: () => Promise<void>) {
    setPending(true);
    setError(null);
    try {
      await run();
    } catch (caught) {
      setError(integrationFailure(caught, "integrations.credentialFailed"));
    } finally {
      setPending(false);
    }
  }
  return (
    <div>
      <p style={dialogHint}>{t("integrations.secretHint")}</p>
      {error && <p role="alert">{integrationFailureText(error, t)}</p>}
      {editing ? (
        <SecretEditor
          path={path}
          existing={editing === "new" ? undefined : editing}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setRevealed(null);
            reload();
          }}
        />
      ) : (
        <>
          {data.canManage && (
            <button style={dialogSaveBtn} onClick={() => setEditing("new")}>
              {t("integrations.addSecret")}
            </button>
          )}
          {!data.secrets.length && <p style={dialogHint}>{t("integrations.noSecrets")}</p>}
          {data.secrets.map((secret) => (
            <section key={secret.name} style={{ borderTop: "1px solid var(--border-subtle)", marginTop: 16, paddingTop: 12 }}>
              <strong style={{ overflowWrap: "anywhere" }}>{secret.name}</strong>
              <p style={dialogHint}>{secret.hosts.join(", ")}</p>
              {secret.note && <p style={dialogHint}>{secret.note}</p>}
              {revealed?.name === secret.name && <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{revealed.value}</pre>}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {data.canReveal && (
                  <button
                    disabled={pending}
                    style={dialogCancelBtn}
                    onClick={() =>
                      void action(async () => {
                        if (revealed?.name === secret.name) {
                          setRevealed(null);
                          return;
                        }
                        const response = await integrationApi<{ value: string }>(`${path}/secrets/${encodeURIComponent(secret.name)}/reveal`);
                        setRevealed({ name: secret.name, value: response.value });
                      })
                    }
                  >
                    {revealed?.name === secret.name ? t("common.hide") : t("common.show")}
                  </button>
                )}
                {data.canManage && (
                  <>
                    <ConnectionTest path={`${path}/secrets/${encodeURIComponent(secret.name)}`} />
                    <button
                      disabled={pending}
                      style={dialogCancelBtn}
                      onClick={() => {
                        setRevealed(null);
                        setEditing(secret);
                      }}
                    >
                      {t("common.edit")}
                    </button>
                    <button disabled={pending} style={dialogCancelBtn} onClick={() => setConfirmation({ name: secret.name, action: "reissue" })}>
                      {t("integrations.reissue")}
                    </button>
                    <button disabled={pending} style={dialogCancelBtn} onClick={() => setConfirmation({ name: secret.name, action: "delete" })}>
                      {t("common.delete")}
                    </button>
                  </>
                )}
              </div>
              {confirmation?.name === secret.name && (
                <div role="group" aria-label={t("integrations.confirmCredential")}>
                  <p style={dialogHint}>{confirmation.action === "reissue" ? t("integrations.reissueHint") : t("integrations.deleteSecretHint")}</p>
                  <button
                    disabled={pending}
                    style={dialogSaveBtn}
                    onClick={() =>
                      void action(async () => {
                        await integrationApi(
                          `${path}/secrets/${encodeURIComponent(secret.name)}${confirmation.action === "reissue" ? "/reissue" : ""}`,
                          confirmation.action === "reissue" ? "POST" : "DELETE",
                        );
                        setConfirmation(null);
                        setRevealed(null);
                        reload();
                      })
                    }
                  >
                    {t("integrations.confirm")}
                  </button>
                  <button disabled={pending} style={dialogCancelBtn} onClick={() => setConfirmation(null)}>
                    {t("common.cancel")}
                  </button>
                </div>
              )}
            </section>
          ))}
        </>
      )}
    </div>
  );
}
