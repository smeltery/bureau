import { BUREAU_DIR } from "../../persistence/paths.ts";
import { withAuditContext } from "../../audit/context.ts";
import { recordAuditEvent } from "../../audit/store.ts";
import { integrationStore, type IntegrationStore } from "../store.ts";
import { createProxyMaterial, type ProxyMaterial } from "./material.ts";
import { startCredentialProxy } from "./server.ts";
import { secretPlaceholder } from "./credentials.ts";
import type { IntegrationScope } from "../../../shared/integrations/connections.ts";

export function createCredentialRuntime(store: IntegrationStore, root: string) {
  let enabled = false;
  let material: ProxyMaterial | null = null;
  let proxy: Awaited<ReturnType<typeof startCredentialProxy>> | null = null;
  let starting: Promise<void> | null = null;
  async function refresh(): Promise<void> {
    if (!enabled || proxy) return;
    if (starting) return starting;
    if (
      !store.scopes().some((scope) => {
        try {
          return store.privateSecrets(scope).length > 0;
        } catch {
          console.error("[integrations] an unreadable scope was excluded during proxy startup");
          return false;
        }
      })
    )
      return;
    starting = (async () => {
      material = await createProxyMaterial(root);
      proxy = await startCredentialProxy(store, material, {
        proxyUrl: process.env.HTTPS_PROXY || process.env.https_proxy,
        noProxy: process.env.NO_PROXY || process.env.no_proxy,
        used(credentials) {
          for (const { scope, secret } of credentials)
            withAuditContext({ actor: scope.kind === "office" ? "office credential" : `member:${scope.userId}`, operation: "integrations.use" }, () =>
              recordAuditEvent(`credentials/${secret.name}`, ["secret"]),
            );
        },
      });
    })().finally(() => {
      starting = null;
    });
    return starting;
  }
  return {
    async enable() {
      enabled = true;
      await refresh();
    },
    refresh,
    environment(userId?: string | null) {
      if (!enabled) return null;
      const officeScope = { kind: "office" as const };
      const memberScope = userId ? { kind: "member" as const, userId } : null;
      const office = store.privateSecrets(officeScope);
      const member = memberScope ? store.privateSecrets(memberScope) : [];
      if (!office.length && !member.length) return null;
      if (!proxy || !material) throw new Error("Credential delivery is not ready. Retry after the integration finishes saving.");
      const hostCredentials = new Map<string, string>();
      function values(scope: IntegrationScope, records: typeof office): Record<string, string> {
        return Object.fromEntries(
          records.map((secret) => {
            const placeholder = secretPlaceholder(material!.placeholderKey, scope, secret);
            if (secret.form.kind === "authorization") for (const host of secret.hosts) hostCredentials.set(host, placeholder);
            return [secret.name, placeholder];
          }),
        );
      }
      const officeValues = values(officeScope, office);
      const memberValues = memberScope ? values(memberScope, member) : {};
      const proxyUrl = `http://127.0.0.1:${proxy.port}`;
      const fixed: Record<string, string> = {
        HTTP_PROXY: proxyUrl,
        HTTPS_PROXY: proxyUrl,
        ALL_PROXY: proxyUrl,
        http_proxy: proxyUrl,
        https_proxy: proxyUrl,
        all_proxy: proxyUrl,
        NO_PROXY: "localhost,127.0.0.1,::1",
        no_proxy: "localhost,127.0.0.1,::1",
        NODE_EXTRA_CA_CERTS: material.trustPath,
        SSL_CERT_FILE: material.trustPath,
        CURL_CA_BUNDLE: material.trustPath,
        REQUESTS_CA_BUNDLE: material.trustPath,
        GIT_SSL_CAINFO: material.trustPath,
      };
      return { office: officeValues, member: memberValues, fixed, gitCredentials: [...hostCredentials.entries()] };
    },
    placeholder(scope: IntegrationScope, name: string): string | null {
      const secret = store.privateSecrets(scope).find((item) => item.name === name);
      return secret && material && proxy ? secretPlaceholder(material.placeholderKey, scope, secret) : null;
    },
    async close() {
      enabled = false;
      if (starting) await starting;
      await proxy?.close();
      proxy = null;
    },
  };
}
export const credentialRuntime = createCredentialRuntime(integrationStore, BUREAU_DIR);

export function appendGitCredentialHelpers(environment: Record<string, string | undefined>, credentials: [string, string][]): void {
  let count = Number(environment.GIT_CONFIG_COUNT ?? "0");
  if (!Number.isSafeInteger(count) || count < 0 || count > 1000) throw new Error("Invalid Git environment configuration count.");
  for (const [host, placeholder] of credentials) {
    const key = `credential.https://${host}.helper`;
    environment[`GIT_CONFIG_KEY_${count}`] = key;
    environment[`GIT_CONFIG_VALUE_${count++}`] = "";
    environment[`GIT_CONFIG_KEY_${count}`] = key;
    environment[`GIT_CONFIG_VALUE_${count++}`] = `!f() { printf '%s\\n' 'username=x-access-token' 'password=${placeholder}'; }; f`;
  }
  environment.GIT_CONFIG_COUNT = String(count);
}
