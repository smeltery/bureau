import { useState } from "react";
import { dialogCancelBtn, dialogHint } from "../../modals/dialog-styles.ts";
import { integrationApi } from "./api.ts";
import type { ConnectionTestResult } from "../../../../server/integrations/connection-test.ts";
export function ConnectionTest({ path }: { path: string }) {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<string | null>(null);
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
            setResult(response.ok ? `Connected${response.label ? ` · ${response.label}` : ""}${response.tools !== undefined ? ` · ${response.tools} tools` : ""}` : response.error);
          } catch (caught) {
            setResult(caught instanceof Error ? caught.message : "Could not test the connection.");
          } finally {
            setPending(false);
          }
        }}
      >
        {pending ? "Testing…" : "Test connection"}
      </button>
      {result && (
        <p role="status" style={dialogHint}>
          {result}
        </p>
      )}
    </div>
  );
}
