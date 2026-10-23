import { useI18n } from "../../../i18n.tsx";
import { useState } from "react";
import { dialogCancelBtn, dialogHint } from "../../modals/dialog-styles.ts";
import { integrationApi, integrationFailure, integrationFailureText, type IntegrationFailure } from "./api.ts";
import type { ConnectionTestResult } from "../../../../server/integrations/connection-test.ts";
export function ConnectionTest({ path }: { path: string }) {
  const { t, tn } = useI18n();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<Extract<ConnectionTestResult, { ok: true }> | { error: IntegrationFailure } | null>(null);
  return (
    <div>
      <button
        type="button"
        style={dialogCancelBtn}
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setResult(null);
          try {
            const response = await integrationApi<ConnectionTestResult>(`${path}/test`, "POST");
            setResult(response.ok ? response : { error: response.error });
          } catch (caught) {
            setResult({ error: integrationFailure(caught, "integrations.testFailed") });
          } finally {
            setPending(false);
          }
        }}
      >
        {pending ? t("integrations.testing") : t("integrations.test")}
      </button>
      {result && (
        <p role="status" style={dialogHint}>
          {"error" in result
            ? integrationFailureText(result.error, t)
            : `${t("common.connected")}${result.label ? ` · ${result.label}` : ""}${result.tools !== undefined ? ` · ${tn("integrations.tools", result.tools)}` : ""}`}
        </p>
      )}
    </div>
  );
}
