import { integrationName, secretForm, secretHosts, type IntegrationScope } from "../../../shared/integrations/connections.ts";
import type { SecretRequestCard, SecretRequestStatus } from "../../../shared/integrations/secret-requests.ts";
import { redactLogEntry } from "../../persistence/logs/log-redaction.ts";
import { validateSecretName, type IntegrationStore } from "../store.ts";

export class SecretRequestError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
interface AgentSnapshot {
  userId: string | null;
  sessionId: string | null;
}
export interface SecretRequestDeps {
  store: IntegrationStore;
  agent: (id: string) => AgentSnapshot | undefined;
  emit: (card: SecretRequestCard) => void;
  changed: (scope: IntegrationScope) => Promise<void>;
  settled: (card: SecretRequestCard, status: "saved" | "declined", username: string) => boolean;
}
export function createSecretRequests(deps: SecretRequestDeps) {
  const records = new Map<string, { card: SecretRequestCard; agent: AgentSnapshot; status: SecretRequestStatus }>();
  function current(record: NonNullable<ReturnType<typeof records.get>>): boolean {
    const agent = deps.agent(record.card.agentId);
    return !!agent && agent.userId === record.agent.userId && agent.sessionId === record.agent.sessionId;
  }
  function read(id: string) {
    const record = records.get(id);
    if (!record) throw new SecretRequestError("This credential request is closed. Ask the agent to create another.", 404);
    if (record.status === "pending" && (record.card.expiresAt <= Date.now() || !current(record))) record.status = "closed";
    return record;
  }
  return {
    open(agentId: string, body: Record<string, unknown>): SecretRequestCard {
      if (Object.keys(body).some((key) => !["name", "hosts", "form", "reason", "scope"].includes(key)))
        throw new SecretRequestError("Provide only a name, hosts, form, reason and scope. Never send a credential value.");
      const agent = deps.agent(agentId);
      if (!agent) throw new SecretRequestError("Agent not found.", 404);
      const name = validateSecretName(integrationName(body.name));
      const hosts = secretHosts(body.hosts);
      const form = secretForm(body.form ?? { kind: "authorization" });
      const reason = typeof body.reason === "string" ? body.reason.trim() : "";
      if (!reason || reason.length > 500 || redactLogEntry({ reason, name }).reason !== reason || redactLogEntry({ name }).name !== name)
        throw new SecretRequestError("Give a brief reason without credential values (up to 500 characters).");
      if (body.scope !== undefined && body.scope !== "member" && body.scope !== "office") throw new SecretRequestError("Scope must be member or office.");
      if (body.scope !== "office" && !agent.userId) throw new SecretRequestError("This agent has no manager; request an office credential instead.", 409);
      const scope: IntegrationScope = body.scope === "office" ? { kind: "office" } : { kind: "member", userId: agent.userId! };
      if (deps.store.list(scope).secrets.some((secret) => secret.name === name))
        throw new SecretRequestError("This secret already exists. Use its configured stand-in or ask the member to rotate it in Settings.", 409);
      for (const [id, record] of records) if (record.card.expiresAt <= Date.now()) records.delete(id);
      if (records.size >= 1000)
        for (const [id, record] of records) {
          if (record.status !== "pending") records.delete(id);
          if (records.size < 1000) break;
        }
      const open = [...records.values()].filter((record) => read(record.card.id).status === "pending");
      if (open.length >= 200 || open.filter((record) => record.card.agentId === agentId).length >= 10)
        throw new SecretRequestError("Too many open credential requests. Finish an existing request first.", 429);
      if (open.some((record) => record.card.name === name && JSON.stringify(record.card.scope) === JSON.stringify(scope)))
        throw new SecretRequestError("A request for this credential is already open.", 409);
      const card: SecretRequestCard = { id: crypto.randomUUID(), agentId, name, hosts, form, reason, scope, expiresAt: Date.now() + 30 * 60_000 };
      records.set(card.id, { card, agent: { ...agent }, status: "pending" });
      try {
        deps.emit(card);
      } catch {
        records.delete(card.id);
        throw new SecretRequestError("Could not create the credential request card.", 500);
      }
      return card;
    },
    listPending() {
      return [...records.keys()]
        .map((id) => read(id))
        .filter((record) => record.status === "pending")
        .map((record) => structuredClone(record.card));
    },
    get(id: string) {
      const record = read(id);
      return { card: record.card, status: record.status };
    },
    async answer(id: string, actor: { userId: string; username: string; owner: boolean }, body: Record<string, unknown>, authorized: () => boolean) {
      const record = read(id);
      const { card } = record;
      if (!authorized() || (card.scope.kind === "office" ? !actor.owner : actor.userId !== card.scope.userId))
        throw new SecretRequestError("Only this credential's member, or an office owner for office credentials, can answer.", 403);
      if (record.status !== "pending") throw new SecretRequestError("This credential request is already closed.", 409);
      if (Object.keys(body).some((key) => key !== "value" && key !== "decline") || (body.decline !== undefined && body.decline !== true))
        throw new SecretRequestError("Provide a secret value or decline the request.");
      if (body.decline === true && body.value !== undefined) throw new SecretRequestError("Decline without sending a credential value.");
      const status = body.decline === true ? "declined" : "saved";
      if (status === "saved") {
        if (typeof body.value !== "string") throw new SecretRequestError("Paste the credential into the masked field.");
        if (deps.store.list(card.scope).secrets.some((secret) => secret.name === card.name)) throw new SecretRequestError("This secret was created after the request. It was not overwritten.", 409);
        deps.store.setSecret(card.scope, card.name, { value: body.value, hosts: card.hosts, form: card.form, note: card.reason });
      }
      record.status = status;
      if (status === "saved") await deps.changed(card.scope);
      let delivered = false;
      if (current(record)) {
        try {
          delivered = deps.settled(card, status, actor.username);
        } catch {
          console.error("[integrations] a completed credential request could not notify its agent");
        }
      }
      return { status, delivered };
    },
  };
}
