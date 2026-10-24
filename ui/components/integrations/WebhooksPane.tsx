import { useI18n } from "../../i18n.tsx";
import { webhookRequest, webhookFailure, webhookFailureText, parseWebhookPayload, WebhookUiError, type WebhookFailure } from "./webhooks/api.ts";
import { useEffect, useState } from "react";
import type { Webhook, WebhookDelivery } from "../../../shared/integrations/webhooks.ts";
import { useAppState } from "../../store.tsx";

import { copyLoadedText } from "../../utils/clipboard-load.ts";
import { copyText } from "../../utils/clipboard.ts";

const DELIVERY_STATUS_KEYS = { accepted: "webhooks.accepted", ignored: "webhooks.ignored", failed: "webhooks.failed", pending: "webhooks.pending" } as const;

const api = (path: string, method = "GET", body?: unknown) => webhookRequest(`/api/webhooks${path}`, method, body);

type HookRow = Webhook & { url: string };
export function WebhooksPane() {
  const { t, rich, language } = useI18n();
  const { agents, cronjobs, sessionContext } = useAppState();
  const [hooks, setHooks] = useState<HookRow[]>([]);
  const [editing, setEditing] = useState<HookRow | null>(null);
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [events, setEvents] = useState("push");
  const [actions, setActions] = useState("");
  const [fields, setFields] = useState("repository.full_name,ref,after");
  const [error, setError] = useState<WebhookFailure | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[] | null>(null);
  const [payload, setPayload] = useState("{}");
  const [testEvent, setTestEvent] = useState("push");
  const [preview, setPreview] = useState<string | { noMatch: true } | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const canManage = (row: { userId?: string | null }) => sessionContext?.role === "owner" || (!!sessionContext?.userId && row.userId === sessionContext.userId);
  const reload = async () => setHooks(await api(""));
  useEffect(() => {
    void reload().catch((err) => setError(webhookFailure(err)));
  }, []);
  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await reload();
    } catch (err) {
      setError(webhookFailure(err));
    } finally {
      setBusy(false);
    }
  }
  function edit(row: HookRow | null) {
    setEditing(row);
    setCopied(false);
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
    <section style={{ padding: 20, maxWidth: 850, overflowWrap: "anywhere" }}>
      <h2>{t("webhooks.title")}</h2>
      <p>{t("webhooks.hint")}</p>
      {error && <p role="alert">{webhookFailureText(error, t)}</p>}
      <button disabled={busy} onClick={() => void perform(reload)}>
        {t("common.refresh")}
      </button>
      <ul>
        {hooks.map((hook) => (
          <li key={hook.id} style={{ margin: "12px 0" }}>
            <strong>{hook.name}</strong> — {hook.enabled ? t("common.enabled") : t("common.paused")} · {hook.events.join(", ")}
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
              {t("common.details")}
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
                  {hook.enabled ? t("webhooks.pause") : t("common.enable")}
                </button>
                <button
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(t("webhooks.deleteConfirm", { name: hook.name })))
                      void perform(async () => {
                        await api(`/${hook.id}`, "DELETE");
                        if (editing?.id === hook.id) edit(null);
                      });
                  }}
                >
                  {t("common.delete")}
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      {editing && <button onClick={() => edit(null)}>{t("webhooks.new")}</button>}
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
        <fieldset disabled={busy || (!!editing && !canManage(editing))} style={{ display: "grid", gap: 8, minWidth: 0 }}>
          <legend>{editing ? t("webhooks.edit") : t("webhooks.new")}</legend>
          <label style={{ display: "grid", gap: 4 }}>
            {t("common.name")} <input style={{ minWidth: 0, maxWidth: "100%" }} required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            {t("webhooks.target")}{" "}
            <select style={{ minWidth: 0, maxWidth: "100%" }} required value={target} onChange={(event) => setTarget(event.target.value)}>
              <option value="">{t("webhooks.choose")}</option>
              {agents.filter(canManage).map((agent) => (
                <option key={agent.id} value={`agent:${agent.id}`}>
                  {t("webhooks.agent", { name: agent.name })}
                </option>
              ))}
              {cronjobs.filter(canManage).map((job) => (
                <option key={job.id} value={`schedule:${job.id}`}>
                  {t("webhooks.schedule", { name: job.name })}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            {t("webhooks.events")} <input style={{ minWidth: 0, maxWidth: "100%" }} required value={events} onChange={(event) => setEvents(event.target.value)} />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            {t("webhooks.actions")} <input style={{ minWidth: 0, maxWidth: "100%" }} value={actions} onChange={(event) => setActions(event.target.value)} />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            {t("webhooks.fields")} <input style={{ minWidth: 0, maxWidth: "100%" }} required value={fields} onChange={(event) => setFields(event.target.value)} />
          </label>
          <button type="submit">{t("common.save")}</button>
        </fieldset>
      </form>
      {editing && (
        <>
          <p>{rich("webhooks.setup", { url: <code>{editing.url}</code>, type: <code>application/json</code> })}</p>
          {canManage(editing) && (
            <button
              disabled={busy}
              onClick={() => {
                if (window.confirm(t("webhooks.rotateConfirm")))
                  void perform(async () => {
                    const result = await api(`/${editing.id}/rotate`, "POST");
                    setSecret(result.secret);
                    setCopied(false);
                  });
              }}
            >
              {t("webhooks.rotate")}
            </button>
          )}
          {canManage(editing) && !secret && (
            <button
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  setCopied(false);
                  if (!(await copyLoadedText(async () => (await api(`/${editing.id}/secret`)).secret))) throw new WebhookUiError("webhooks.clipboard");
                  setCopied(true);
                })
              }
            >
              {t("webhooks.copySigning")}
            </button>
          )}
          {copied && <p role="status">{t("webhooks.copied")}</p>}
          {secret && (
            <p>
              <label style={{ display: "grid", gap: 4 }}>
                {t("webhooks.copyNow")} <input style={{ minWidth: 0, maxWidth: "100%" }} type="password" readOnly value={secret} autoComplete="off" />
              </label>{" "}
              <button
                onClick={() => {
                  setCopied(false);
                  setError(null);
                  void copyText(secret).then((ok) => {
                    if (ok) setCopied(true);
                    else setError({ key: "webhooks.clipboardManual" });
                  });
                }}
              >
                {t("webhooks.copy")}
              </button>{" "}
              <button onClick={() => setSecret(null)}>{t("common.close")}</button>
            </p>
          )}
          {canManage(editing) && (
            <div>
              <h3>{t("webhooks.test")}</h3>
              <label style={{ display: "grid", gap: 4 }}>
                {t("webhooks.event")} <input style={{ minWidth: 0, maxWidth: "100%" }} value={testEvent} onChange={(event) => setTestEvent(event.target.value)} />
              </label>
              <textarea aria-label={t("webhooks.payload")} rows={6} value={payload} onChange={(event) => setPayload(event.target.value)} style={{ width: "100%" }} />
              <button
                disabled={busy}
                onClick={() => void perform(async () => setPreview((await api(`/${editing.id}/test`, "POST", { event: testEvent, payload: parseWebhookPayload(payload) })).data ?? { noMatch: true }))}
              >
                {t("webhooks.preview")}
              </button>
              {preview && <pre style={{ whiteSpace: "pre-wrap" }}>{typeof preview === "string" ? preview : t("webhooks.noMatch")}</pre>}
            </div>
          )}
          {deliveries && (
            <>
              <h3>{t("webhooks.deliveries")}</h3>
              <ul>
                {deliveries.map((row) => (
                  <li key={row.id}>
                    {new Date(row.at).toLocaleString(language)} · {row.event} · {t(DELIVERY_STATUS_KEYS[row.status])} · <code>{row.id}</code>
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
