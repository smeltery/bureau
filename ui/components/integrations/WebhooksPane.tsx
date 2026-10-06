import { useEffect, useState } from "react";
import type { Webhook, WebhookDelivery } from "../../../shared/integrations/webhooks.ts";
import { useAppState } from "../../store.tsx";

type HookRow = Webhook & { url: string };
async function api(path: string, method = "GET", body?: unknown) {
  const response = await fetch(`/api/webhooks${path}`, { method, headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(data?.error ?? `Request failed (${response.status})`);
  return data;
}

export function WebhooksPane() {
  const { agents, cronjobs, sessionContext } = useAppState();
  const [hooks, setHooks] = useState<HookRow[]>([]);
  const [editing, setEditing] = useState<HookRow | null>(null);
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [events, setEvents] = useState("push");
  const [actions, setActions] = useState("");
  const [fields, setFields] = useState("repository.full_name,ref,after");
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[] | null>(null);
  const [payload, setPayload] = useState("{}");
  const [testEvent, setTestEvent] = useState("push");
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canManage = (row: { userId?: string | null }) => sessionContext?.role === "owner" || (!!sessionContext?.userId && row.userId === sessionContext.userId);
  const reload = async () => setHooks(await api(""));
  useEffect(() => {
    void reload().catch((err: Error) => setError(err.message));
  }, []);
  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }
  function edit(row: HookRow | null) {
    setEditing(row);
    setName(row?.name ?? "");
    setTarget(row ? `${row.target.kind}:${row.target.id}` : "");
    setEvents(row?.events.join(",") ?? "push");
    setActions(row?.actions.join(",") ?? "");
    setFields(row?.fields.join(",") ?? "repository.full_name,ref,after");
    setSecret(null);
    setPreview(null);
    setDeliveries(null);
  }
  const split = (text: string) =>
    text
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
  return (
    <section style={{ padding: 20, maxWidth: 850 }}>
      <h2>Webhooks</h2>
      <p>Let GitHub events message an agent or start a saved schedule. Only the selected payload fields reach the target. GitHub must be able to reach your office URL.</p>
      {error && <p role="alert">{error}</p>}
      <button disabled={busy} onClick={() => void perform(reload)}>
        Refresh
      </button>
      <ul>
        {hooks.map((hook) => (
          <li key={hook.id} style={{ margin: "12px 0" }}>
            <strong>{hook.name}</strong> — {hook.enabled ? "enabled" : "paused"} · {hook.events.join(", ")}
            <div>
              <code>{hook.url}</code>
            </div>
            <button
              disabled={busy}
              onClick={() => {
                edit(hook);
                void perform(async () => setDeliveries(await api(`/${hook.id}/deliveries`)));
              }}
            >
              Details
            </button>
            {canManage(hook) && (
              <>
                <button
                  disabled={busy}
                  onClick={() =>
                    void perform(async () => {
                      await api(`/${hook.id}`, "PATCH", { enabled: !hook.enabled });
                    })
                  }
                >
                  {hook.enabled ? "Pause" : "Enable"}
                </button>
                <button
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(`Delete webhook ${hook.name}?`))
                      void perform(async () => {
                        await api(`/${hook.id}`, "DELETE");
                        if (editing?.id === hook.id) edit(null);
                      });
                  }}
                >
                  Delete
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      {editing && <button onClick={() => edit(null)}>New webhook</button>}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void perform(async () => {
            const [kind, id] = target.split(":");
            const result = await api(editing ? `/${editing.id}` : "", editing ? "PATCH" : "POST", {
              name,
              target: { kind, id },
              events: split(events),
              actions: split(actions),
              fields: split(fields),
            });
            const { secret: newSecret, ...row } = result;
            edit(row);
            if (newSecret) setSecret(newSecret);
          });
        }}
      >
        <fieldset disabled={busy || (!!editing && !canManage(editing))} style={{ display: "grid", gap: 8 }}>
          <legend>{editing ? "Edit webhook" : "New webhook"}</legend>
          <label>
            Name <input required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label>
            Target{" "}
            <select required value={target} onChange={(event) => setTarget(event.target.value)}>
              <option value="">Choose a target</option>
              {agents.filter(canManage).map((agent) => (
                <option key={agent.id} value={`agent:${agent.id}`}>
                  Agent: {agent.name}
                </option>
              ))}
              {cronjobs.filter(canManage).map((job) => (
                <option key={job.id} value={`schedule:${job.id}`}>
                  Schedule: {job.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Events (comma separated) <input required value={events} onChange={(event) => setEvents(event.target.value)} />
          </label>
          <label>
            Actions (optional) <input value={actions} onChange={(event) => setActions(event.target.value)} />
          </label>
          <label>
            Payload fields (dotted paths) <input required value={fields} onChange={(event) => setFields(event.target.value)} />
          </label>
          <button type="submit">Save</button>
        </fieldset>
      </form>
      {editing && (
        <>
          <p>
            GitHub settings: Payload URL <code>{editing.url}</code>; Content type <code>application/json</code>; choose the listed events and paste the secret below.
          </p>
          {canManage(editing) && (
            <button
              disabled={busy}
              onClick={() => {
                if (window.confirm("Rotate the signing secret? Update GitHub before new deliveries can arrive."))
                  void perform(async () => setSecret((await api(`/${editing.id}/rotate`, "POST")).secret));
              }}
            >
              Rotate secret
            </button>
          )}
          {secret && (
            <p>
              <label>
                Copy this secret now <input type="password" readOnly value={secret} autoComplete="off" />
              </label>{" "}
              <button onClick={() => void navigator.clipboard.writeText(secret).catch(() => setError("Clipboard unavailable; select and copy the secret field."))}>Copy secret</button>{" "}
              <button onClick={() => setSecret(null)}>Dismiss</button>
            </p>
          )}
          {canManage(editing) && (
            <div>
              <h3>Test rule without dispatching</h3>
              <label>
                Event <input value={testEvent} onChange={(event) => setTestEvent(event.target.value)} />
              </label>
              <textarea aria-label="Sample JSON payload" rows={6} value={payload} onChange={(event) => setPayload(event.target.value)} style={{ width: "100%" }} />
              <button
                disabled={busy}
                onClick={() => void perform(async () => setPreview((await api(`/${editing.id}/test`, "POST", { event: testEvent, payload: JSON.parse(payload) })).data ?? "Rule did not match."))}
              >
                Preview selected data
              </button>
              {preview && <pre style={{ whiteSpace: "pre-wrap" }}>{preview}</pre>}
            </div>
          )}
          {deliveries && (
            <>
              <h3>Recent deliveries</h3>
              <ul>
                {deliveries.map((row) => (
                  <li key={row.id}>
                    {new Date(row.at).toLocaleString()} · {row.event} · {row.status} · <code>{row.id}</code>
                    {row.resultId && (
                      <>
                        {" "}
                        → <code>{row.resultId}</code>
                      </>
                    )}
                    {row.error && ` · ${row.error}`}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}
