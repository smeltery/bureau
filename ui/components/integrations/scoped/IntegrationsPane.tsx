import { VoicePane } from "../../../voice/VoicePane.tsx";
import { McpPane } from "./McpPane.tsx";
import { useEffect, useState } from "react";
import { useAppState } from "../../../store.tsx";
import { ConnectionsPane } from "../../ConnectionsPane.tsx";
import { dialogCancelBtn, dialogHint, dialogInput, dialogLabel } from "../../modals/dialog-styles.ts";
import { integrationApi, type IntegrationListing } from "./api.ts";
import { SecretsPane } from "./SecretsPane.tsx";
import { VariablesPane } from "./VariablesPane.tsx";

type Tab = "Providers" | "Voice" | "MCP" | "Secrets" | "Variables";
export function IntegrationsPane() {
  const { sessionContext, users } = useAppState();
  const [tab, setTab] = useState<Tab>("Providers");
  const [scope, setScope] = useState(sessionContext ? `members/${sessionContext.userId}` : "office");
  const [data, setData] = useState<IntegrationListing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const path = `/api/integrations/${scope}`;
  useEffect(() => {
    let active = true;
    setData(null);
    setError(null);
    if (tab !== "Providers" && tab !== "Voice")
      void integrationApi<IntegrationListing>(path)
        .then((result) => {
          if (active) setData(result);
        })
        .catch((caught) => {
          if (active) setError(caught instanceof Error ? caught.message : "Could not load integrations.");
        });
    return () => {
      active = false;
    };
  }, [path, revision, tab]);
  if (!sessionContext) return null;
  const members = [...users.values()].filter((user) => sessionContext.role === "owner" || user.id === sessionContext.userId);
  return (
    <section aria-label="Integrations">
      <h3>Integrations</h3>
      <p style={dialogHint}>Manage provider accounts, scoped credentials and environment variables. Member values override office values with the same name.</p>
      <nav aria-label="Integration categories" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
        {(["Providers", "Voice", "MCP", "Secrets", "Variables"] as const).map((item) => (
          <button key={item} aria-pressed={tab === item} style={{ ...dialogCancelBtn, ...(tab === item ? { borderColor: "var(--accent)", color: "var(--accent)" } : {}) }} onClick={() => setTab(item)}>
            {item}
          </button>
        ))}
      </nav>
      {tab === "Providers" ? (
        <ConnectionsPane username={sessionContext.username} />
      ) : tab === "Voice" ? (
        <VoicePane key={sessionContext.userId} />
      ) : (
        <>
          <label style={dialogLabel}>
            Scope
            <select style={dialogInput} value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="office">Office · shared by all agents</option>
              {members.map((member) => (
                <option key={member.id} value={`members/${member.id}`}>
                  {member.name}
                  {member.id === sessionContext.userId ? " · you" : ""}
                </option>
              ))}
            </select>
          </label>
          {error ? (
            <div role="alert">
              <p>{error}</p>
              <button style={dialogCancelBtn} onClick={() => setRevision((value) => value + 1)}>
                Retry
              </button>
            </div>
          ) : !data ? (
            <p role="status" style={dialogHint}>
              Loading integrations…
            </p>
          ) : (
            <div key={`${path}/${tab}`}>
              {!data.canManage && <p style={dialogHint}>These office integrations are shared with your agents. Ask an owner to change them.</p>}
              {tab === "MCP" ? (
                <McpPane path={path} data={data} reload={() => setRevision((value) => value + 1)} />
              ) : tab === "Secrets" ? (
                <SecretsPane path={path} data={data} reload={() => setRevision((value) => value + 1)} />
              ) : (
                <VariablesPane path={path} data={data} reload={() => setRevision((value) => value + 1)} />
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
