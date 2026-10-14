export class IntegrationValidationError extends Error {}
export type IntegrationScope = { kind: "office" } | { kind: "member"; userId: string };
export type SecretForm = { kind: "authorization" } | { kind: "header"; header: string };
export interface SecretMetadata {
  name: string;
  hosts: string[];
  form: SecretForm;
  note: string;
  createdAt: number;
  updatedAt: number;
}
export interface RemoteMcpServer {
  id?: string;
  oauth?: boolean;
  name: string;
  url: string;
  secret: string | null;
  note: string;
  createdAt: number;
  updatedAt: number;
}
export const SECRET_PRESETS = [
  { label: "GitHub", name: "GH_TOKEN", hosts: ["api.github.com", "github.com", "uploads.github.com"] },
  { label: "Stripe", name: "STRIPE_API_KEY", hosts: ["api.stripe.com", "files.stripe.com"] },
  { label: "Fly", name: "FLY_API_TOKEN", hosts: ["api.fly.io", "api.machines.dev"] },
] as const;

const excludedDomains = [
  "anthropic.com",
  "claude.ai",
  "claude.com",
  "openai.com",
  "chatgpt.com",
  "openai.azure.com",
  "openrouter.ai",
  "mistral.ai",
  "groq.com",
  "deepseek.com",
  "x.ai",
  "opencode.ai",
  "npmjs.org",
  "npmjs.com",
  "yarnpkg.com",
  "pypi.org",
  "pythonhosted.org",
  "crates.io",
  "golang.org",
  "jsr.io",
  "rubygems.org",
  "maven.org",
];
export function excludedSecretHost(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^\*\./, "").replace(/:\d+$/, "").replace(/\.+$/, "");
  return (
    excludedDomains.some((domain) => normalized === domain || normalized.endsWith(`.${domain}`)) ||
    ["generativelanguage.googleapis.com", "aiplatform.googleapis.com", "repo.maven.apache.org"].includes(normalized) ||
    /^[a-z0-9-]+-aiplatform\.googleapis\.com$/.test(normalized) ||
    /^bedrock(?:-runtime|-agent-runtime)?(?:-fips)?\.[a-z0-9-]+\.amazonaws\.com$/.test(normalized)
  );
}
export function validSecretHost(host: string): boolean {
  return (
    host.length <= 253 &&
    host === host.toLowerCase() &&
    host.includes(".") &&
    !/^\d+(?:\.\d+){3}$/.test(host) &&
    host.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) &&
    !excludedSecretHost(host)
  );
}
export function integrationName(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(value) || ["__proto__", "constructor", "prototype"].includes(value))
    throw new IntegrationValidationError("Name must use letters, numbers and underscores, starting with a letter or underscore.");
  return value;
}
export function connectionNote(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string" || value.length > 2000) throw new IntegrationValidationError("Agent usage note must be at most 2,000 characters.");
  return value.trim();
}
export function secretHosts(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20 || !value.every((host) => typeof host === "string" && validSecretHost(host)))
    throw new IntegrationValidationError("List 1–20 exact lowercase hosts. Model providers, package registries, IPs and wildcards are excluded.");
  return [...new Set(value)];
}
export function secretForm(value: unknown): SecretForm {
  if (!value || typeof value !== "object") throw new IntegrationValidationError("Choose an authorization or named-header credential.");
  const form = value as Record<string, unknown>;
  if (form.kind === "authorization") return { kind: "authorization" };
  if (
    form.kind === "header" &&
    typeof form.header === "string" &&
    /^[a-z][a-z0-9-]{0,63}$/.test(form.header) &&
    !["host", "connection", "content-length", "transfer-encoding", "cookie", "set-cookie", "proxy-authorization", "authorization"].includes(form.header)
  )
    return { kind: "header", header: form.header };
  throw new IntegrationValidationError("Use a lowercase credential header name; routing and framing headers are excluded.");
}
export function remoteMcpUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 4096) throw new IntegrationValidationError("A remote HTTPS MCP URL is required.");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new IntegrationValidationError("A valid remote HTTPS MCP URL is required.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new IntegrationValidationError("MCP URLs must use HTTPS without user information or fragments.");
  return url.href;
}
