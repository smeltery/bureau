import { expect, test } from "bun:test";
import { selectVoiceCredential } from "./credentials.ts";
import type { StoredSecret } from "../integrations/store.ts";
test("voice resolves the dedicated key before fallback and member before office", () => {
  const layers = [
    { source: "member" as const, values: { OPENAI_API_KEY: "member-api" } },
    { source: "office" as const, values: { OPENAI_VOICE_API_KEY: "office-voice" } },
  ];
  expect(selectVoiceCredential(layers).key).toBe("office-voice");
  layers[0].values = { OPENAI_VOICE_API_KEY: "member-voice" } as (typeof layers)[0]["values"];
  expect(selectVoiceCredential(layers).key).toBe("member-voice");
});
test("scoped secrets override variables but never bypass their host or authentication constraints", () => {
  const secret = { name: "OPENAI_VOICE_API_KEY", value: "member-secret", hosts: ["other.example"], form: { kind: "authorization" } } as StoredSecret;
  const layers = [{ source: "member" as const, values: { OPENAI_VOICE_API_KEY: "variable", OPENAI_API_KEY: "fallback" }, secrets: [secret] }];
  expect(selectVoiceCredential(layers)).toMatchObject({ available: false, key: null });
  secret.hosts = ["api.openai.com"];
  expect(selectVoiceCredential(layers).key).toBe("member-secret");
  secret.form = { kind: "header", header: "x-api-key" };
  expect(selectVoiceCredential(layers).available).toBe(false);
  expect(selectVoiceCredential([{ source: "server", values: { OPENAI_VOICE_API_KEY: "bad\nheader" } }]).available).toBe(false);
});
