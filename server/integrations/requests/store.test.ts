import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIntegrationStore } from "../store.ts";
import { createSecretRequests } from "./store.ts";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "bureau-secret-request-"));
  const store = createIntegrationStore(root);
  const agent = { userId: "member-a" as string | null, sessionId: "conversation-1" as string | null };
  const emitted: unknown[] = [];
  const settled: unknown[] = [];
  const requests = createSecretRequests({
    store,
    agent: () => agent,
    emit: (card) => {
      emitted.push(card);
    },
    changed: async () => {},
    settled: (card, status, username) => {
      settled.push({ card, status, username });
      return true;
    },
  });
  return { root, store, agent, emitted, settled, requests };
}
const actor = { userId: "member-a", username: "Member", owner: false };
const ask = { name: "SERVICE_TOKEN", hosts: ["api.example.test"], reason: "Read the project's issue list." };

test("secret requests persist only human-approved values and never emit them", async () => {
  const f = fixture();
  try {
    const card = f.requests.open("agent", ask);
    await expect(f.requests.answer(card.id, { userId: "other", username: "Owner", owner: true }, { value: "private-secret-value" }, () => true)).rejects.toThrow("Only this credential");
    await expect(f.requests.answer(card.id, actor, { value: "private-secret-value" }, () => false)).rejects.toThrow("Only this credential");
    expect(await f.requests.answer(card.id, actor, { value: "private-secret-value" }, () => true)).toEqual({ status: "saved", delivered: true });
    expect(f.store.privateSecrets({ kind: "member", userId: actor.userId })[0]!.value).toBe("private-secret-value");
    expect(JSON.stringify({ emitted: f.emitted, settled: f.settled, status: f.requests.get(card.id) })).not.toContain("private-secret-value");
    await expect(f.requests.answer(card.id, actor, { value: "replacement-value" }, () => true)).rejects.toThrow("already closed");
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("stale and competing requests never overwrite credentials", async () => {
  const f = fixture();
  try {
    expect(() => f.requests.open("agent", { ...ask, value: "must-not-enter-chat" })).toThrow("Never send a credential");
    expect(() => f.requests.open("agent", { ...ask, reason: `Use ghp_${"a".repeat(36)}` })).toThrow("without credential");
    expect(() => f.requests.open("agent", { ...ask, name: "HTTPS_PROXY" })).toThrow("reserved");
    const card = f.requests.open("agent", ask);
    expect(() => f.requests.open("agent", ask)).toThrow("already open");
    f.store.setSecret(card.scope, card.name, { value: "existing-private-token", hosts: card.hosts, form: card.form });
    await expect(f.requests.answer(card.id, actor, { value: "replacement-value" }, () => true)).rejects.toThrow("not overwritten");
    f.agent.sessionId = "conversation-2";
    expect(f.requests.get(card.id).status).toBe("closed");
    await expect(f.requests.answer(card.id, actor, { decline: true }, () => true)).rejects.toThrow("already closed");
    const office = f.requests.open("agent", { ...ask, name: "OFFICE_TOKEN", scope: "office" });
    await expect(f.requests.answer(office.id, actor, { decline: true }, () => true)).rejects.toThrow("Only this credential");
    expect((await f.requests.answer(office.id, { ...actor, owner: true }, { decline: true }, () => true)).status).toBe("declined");
    expect(f.store.list({ kind: "office" }).secrets).toEqual([]);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
