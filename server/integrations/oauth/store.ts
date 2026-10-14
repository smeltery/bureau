import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { OAuthClientInformationMixed, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { OAuthDiscoveryState } from "@modelcontextprotocol/sdk/client/auth.js";
import type { IntegrationScope, RemoteMcpServer } from "../../../shared/integrations/connections.ts";
import { BUREAU_DIR } from "../../persistence/paths.ts";

export interface McpOAuthRecord {
  scope: IntegrationScope;
  name: string;
  url: string;
  createdAt: number;
  registrationId?: string;
  redirectUri: string;
  client?: OAuthClientInformationMixed;
  discovery?: OAuthDiscoveryState;
  tokens?: OAuthTokens;
  expiresAt?: number;
  signInNeeded?: boolean;
}
export const oauthKey = (scope: IntegrationScope, name: string) =>
  createHash("sha256")
    .update(JSON.stringify([scope, name]))
    .digest("hex");
export function createOAuthStore(root = BUREAU_DIR) {
  const directory = join(root, "integrations", "oauth");
  function prefix(scope: IntegrationScope): string {
    if (scope.kind === "office") return "office-";
    if (!/^[A-Za-z0-9_-]+$/.test(scope.userId)) throw new Error("Invalid member scope.");
    return `member-${scope.userId}-`;
  }
  const path = (scope: IntegrationScope, name: string) => join(directory, `${prefix(scope)}${oauthKey(scope, name)}.json`);
  function read(scope: IntegrationScope, name: string): McpOAuthRecord | null {
    const file = path(scope, name);
    if (!existsSync(file)) return null;
    const record = JSON.parse(readFileSync(file, "utf8")) as McpOAuthRecord;
    if (record.name !== name || oauthKey(record.scope, name) !== oauthKey(scope, name) || typeof record.url !== "string" || !Number.isFinite(record.createdAt))
      throw new Error("MCP sign-in storage could not be read.");
    return record;
  }
  return {
    read,
    write(record: McpOAuthRecord) {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      chmodSync(directory, 0o700);
      const file = path(record.scope, record.name);
      const temporary = `${file}.${crypto.randomUUID()}.tmp`;
      try {
        writeFileSync(temporary, JSON.stringify(record), { mode: 0o600, flag: "wx" });
        renameSync(temporary, file);
      } finally {
        rmSync(temporary, { force: true });
      }
    },
    remove(scope: IntegrationScope, name: string) {
      rmSync(path(scope, name), { force: true });
    },
    removeMember(userId: string) {
      const start = prefix({ kind: "member", userId });
      if (!existsSync(directory)) return;
      for (const file of readdirSync(directory)) if (file.startsWith(start) && /^[a-f0-9]{64}\.json$/.test(file.slice(start.length))) rmSync(join(directory, file), { force: true });
    },
    list(): McpOAuthRecord[] {
      if (!existsSync(directory)) return [];
      return readdirSync(directory)
        .filter((file) => /^(?:office|member-[A-Za-z0-9_-]+)-[a-f0-9]{64}\.json$/.test(file))
        .flatMap((file) => {
          try {
            const data = JSON.parse(readFileSync(join(directory, file), "utf8"));
            const record = read(data.scope, data.name);
            return record ? [record] : [];
          } catch {
            console.error("[integrations] unreadable MCP sign-in storage was preserved");
            return [];
          }
        });
    },
  };
}
export const oauthStore = createOAuthStore();
export function oauthAccessToken(scope: IntegrationScope, server: RemoteMcpServer, store = oauthStore): string | null {
  if (!server.oauth) return null;
  try {
    const record = store.read(scope, server.name);
    return record &&
      record.url === server.url &&
      record.createdAt === server.createdAt &&
      record.registrationId === server.id &&
      !record.signInNeeded &&
      (record.expiresAt ?? 0) > Date.now() &&
      record.tokens?.access_token
      ? record.tokens.access_token
      : null;
  } catch {
    return null;
  }
}
