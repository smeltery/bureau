import { createHmac } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import type { IntegrationScope } from "../../../shared/integrations/connections.ts";
import { integrationScopeKey, type IntegrationStore, type StoredSecret } from "../store.ts";

export interface ProxyCredential {
  scope: IntegrationScope;
  secret: StoredSecret;
  placeholder: string;
}
export function secretPlaceholder(key: Buffer, scope: IntegrationScope, secret: StoredSecret): string {
  const prefix = /^(github_pat_|gh[pousr]_|(?:sk|rk)_(?:live|test)_|FlyV1 fm2_)/.exec(secret.value)?.[0] ?? "";
  const length = prefix === "github_pat_" ? 82 : prefix.startsWith("gh") ? 36 : prefix.startsWith("sk_") || prefix.startsWith("rk_") ? 99 : 64;
  const digest = createHmac("sha512", key)
    .update(`${integrationScopeKey(scope)}\0${secret.name}\0${secret.generation}`)
    .digest("hex");
  return prefix + digest.slice(0, length);
}
export function proxyCredentials(store: IntegrationStore, key: Buffer): ProxyCredential[] {
  return store.scopes().flatMap((scope) => {
    try {
      return store.privateSecrets(scope).map((secret) => ({ scope, secret, placeholder: secretPlaceholder(key, scope, secret) }));
    } catch {
      // A damaged scope loses credential delivery without taking unrelated scopes offline.
      console.error("[integrations] an unreadable scope was excluded from credential delivery");
      return [];
    }
  });
}
export class CredentialDestinationError extends Error {}
export function injectCredentials(host: string, headers: IncomingHttpHeaders, credentials: ProxyCredential[]): { headers: Record<string, string | string[]>; used: ProxyCredential[] } {
  const output: Record<string, string | string[]> = {};
  const used = new Set<ProxyCredential>();
  for (const [name, raw] of Object.entries(headers)) {
    if (raw === undefined) continue;
    const values = Array.isArray(raw) ? raw : [raw];
    const replaced = values.map((original) => {
      const basic = name === "authorization" && /^Basic\s+/i.test(original);
      let value = basic ? Buffer.from(original.replace(/^Basic\s+/i, ""), "base64").toString("utf8") : original;
      for (const credential of credentials) {
        if (!value.includes(credential.placeholder)) continue;
        const form = credential.secret.form;
        if (!credential.secret.hosts.includes(host) || (form.kind === "authorization" ? name !== "authorization" : name !== form.header))
          throw new CredentialDestinationError("Credential is not permitted for this host or header.");
        value = value.replaceAll(credential.placeholder, credential.secret.value);
        used.add(credential);
      }
      return basic ? `Basic ${Buffer.from(value).toString("base64")}` : value;
    });
    output[name] = Array.isArray(raw) ? replaced : replaced[0]!;
  }
  return { headers: output, used: [...used] };
}
