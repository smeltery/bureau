import { chmodSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { BUREAU_DIR } from "../persistence/paths.ts";
import { recordAuditEvent } from "../audit/store.ts";
import {
  IntegrationValidationError,
  connectionNote,
  integrationName,
  remoteMcpUrl,
  secretForm,
  secretHosts,
  type IntegrationScope,
  type RemoteMcpServer,
  type SecretMetadata,
} from "../../shared/integrations/connections.ts";

export interface StoredSecret extends SecretMetadata {
  value: string;
  generation: string;
}
interface StoredConnections {
  version: 1;
  secrets: StoredSecret[];
  mcp: RemoteMcpServer[];
}
const protectedNames = /^(?:BUREAU_|GIT_CONFIG_|NODE_EXTRA_CA_CERTS$|SSL_CERT_FILE$|REQUESTS_CA_BUNDLE$|CURL_CA_BUNDLE$|HTTPS?_PROXY$|ALL_PROXY$|NO_PROXY$)/i;
export class IntegrationStoreError extends Error {}
export function validateSecretName(name: string): string {
  integrationName(name);
  if (protectedNames.test(name)) throw new IntegrationValidationError("This environment name is reserved by the runtime.");
  return name;
}

export function integrationScopeKey(scope: IntegrationScope): string {
  if (scope.kind === "office") return "office";
  if (!/^[A-Za-z0-9_-]+$/.test(scope.userId)) throw new IntegrationValidationError("Invalid member id.");
  return `member-${scope.userId}`;
}
export function createIntegrationStore(root = BUREAU_DIR) {
  const directory = join(root, "integrations");
  const pathFor = (scope: IntegrationScope) => join(directory, `${integrationScopeKey(scope)}.json`);
  function read(scope: IntegrationScope): StoredConnections {
    const path = pathFor(scope);
    if (!existsSync(path)) return { version: 1, secrets: [], mcp: [] };
    try {
      const state = JSON.parse(readFileSync(path, "utf8"));
      if (state.version !== 1 || !Array.isArray(state.secrets) || !Array.isArray(state.mcp)) throw new IntegrationValidationError("invalid store");
      for (const secret of state.secrets) {
        integrationName(secret.name);
        secretHosts(secret.hosts);
        secretForm(secret.form);
        connectionNote(secret.note);
        if (typeof secret.value !== "string" || typeof secret.generation !== "string" || !Number.isFinite(secret.createdAt) || !Number.isFinite(secret.updatedAt))
          throw new IntegrationValidationError("invalid secret");
      }
      if (new Set(state.secrets.map((secret: StoredSecret) => secret.name)).size !== state.secrets.length) throw new Error("duplicate secret");
      if (new Set(state.mcp.map((server: RemoteMcpServer) => server.name)).size !== state.mcp.length) throw new Error("duplicate server");
      for (const server of state.mcp) {
        integrationName(server.name);
        remoteMcpUrl(server.url);
        connectionNote(server.note);
        if (server.secret !== null) integrationName(server.secret);
        if (server.oauth !== undefined && typeof server.oauth !== "boolean") throw new Error("invalid OAuth setting");
        if (server.id !== undefined && typeof server.id !== "string") throw new Error("invalid registration id");
        if (!Number.isFinite(server.createdAt) || !Number.isFinite(server.updatedAt)) throw new Error("invalid server");
      }
      return state;
    } catch {
      throw new IntegrationStoreError("The integration store could not be read. Its contents were preserved.");
    }
  }
  function write(scope: IntegrationScope, state: StoredConnections): void {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
    const path = pathFor(scope);
    const temporary = `${path}.${crypto.randomUUID()}.tmp`;
    let fd: number | null = null;
    try {
      fd = openSync(temporary, "wx", 0o600);
      writeFileSync(fd, JSON.stringify(state));
      fsyncSync(fd);
      closeSync(fd);
      fd = null;
      renameSync(temporary, path);
      recordAuditEvent(`integrations/${integrationScopeKey(scope)}`, ["connections"]);
    } finally {
      if (fd !== null) closeSync(fd);
      rmSync(temporary, { force: true });
    }
  }
  function metadata(secret: StoredSecret): SecretMetadata {
    const { value: _value, generation: _generation, ...wire } = secret;
    return wire;
  }
  return {
    list(scope: IntegrationScope) {
      const state = read(scope);
      return { secrets: state.secrets.map(metadata), mcp: state.mcp };
    },
    privateSecrets(scope: IntegrationScope): StoredSecret[] {
      return read(scope).secrets;
    },
    scopes(): IntegrationScope[] {
      if (!existsSync(directory)) return [];
      return readdirSync(directory).flatMap((file): IntegrationScope[] =>
        file === "office.json" ? [{ kind: "office" }] : /^member-[A-Za-z0-9_-]+\.json$/.test(file) ? [{ kind: "member", userId: file.slice(7, -5) }] : [],
      );
    },
    setSecret(scope: IntegrationScope, name: string, input: Record<string, unknown>): SecretMetadata {
      validateSecretName(name);
      const state = read(scope);
      const existing = state.secrets.find((secret) => secret.name === name);
      const value = input.value === undefined ? existing?.value : input.value;
      if (typeof value !== "string" || value.length < 8 || value.length > 16384 || /[\x00-\x1f\x7f]/.test(value))
        throw new IntegrationValidationError("Secret values must contain 8–16,384 characters without line breaks.");
      const secret: StoredSecret = {
        name,
        value,
        hosts: secretHosts(input.hosts ?? existing?.hosts),
        form: secretForm(input.form ?? existing?.form),
        note: connectionNote(input.note === undefined ? existing?.note : input.note),
        generation: existing?.generation ?? randomBytes(24).toString("hex"),
        createdAt: existing?.createdAt ?? Date.now(),
        updatedAt: Date.now(),
      };
      state.secrets = [...state.secrets.filter((item) => item.name !== name), secret];
      write(scope, state);
      return metadata(secret);
    },
    setMcp(scope: IntegrationScope, name: string, input: Record<string, unknown>): RemoteMcpServer {
      integrationName(name);
      const state = read(scope);
      const existing = state.mcp.find((server) => server.name === name);
      const url = remoteMcpUrl(input.url ?? existing?.url);
      const oauth = input.oauth === undefined ? (existing?.oauth ?? false) : input.oauth;
      if (typeof oauth !== "boolean") throw new IntegrationValidationError("Choose whether this connection uses browser sign-in.");
      const secret = oauth ? null : input.secret === undefined ? (existing?.secret ?? null) : input.secret === null || input.secret === "" ? null : integrationName(input.secret);
      if (secret && new URL(url).port) throw new IntegrationValidationError("Credential-backed MCP servers must use HTTPS port 443.");
      if (secret && !state.secrets.some((item) => item.name === secret && item.hosts.includes(new URL(url).hostname)))
        throw new IntegrationValidationError("Choose a secret in this scope that allows the MCP server’s host.");
      const server: RemoteMcpServer = {
        id: existing?.id ?? crypto.randomUUID(),
        name,
        url,
        secret,
        oauth,
        note: connectionNote(input.note === undefined ? existing?.note : input.note),
        createdAt: existing?.createdAt ?? Date.now(),
        updatedAt: Date.now(),
      };
      state.mcp = [...state.mcp.filter((item) => item.name !== name), server];
      write(scope, state);
      return server;
    },
    remove(scope: IntegrationScope, kind: "secrets" | "mcp", name: string): boolean {
      const state = read(scope);
      const before = state[kind].length;
      if (kind === "secrets") state.secrets = state.secrets.filter((item) => item.name !== name);
      else state.mcp = state.mcp.filter((item) => item.name !== name);
      if (state[kind].length === before) return false;
      write(scope, state);
      return true;
    },
    reissue(scope: IntegrationScope, name: string): boolean {
      const state = read(scope);
      const secret = state.secrets.find((item) => item.name === name);
      if (!secret) return false;
      secret.generation = randomBytes(24).toString("hex");
      secret.updatedAt = Date.now();
      write(scope, state);
      return true;
    },
    removeMember(userId: string): void {
      rmSync(pathFor({ kind: "member", userId }), { force: true });
    },
  };
}
export type IntegrationStore = ReturnType<typeof createIntegrationStore>;
export const integrationStore = createIntegrationStore();
