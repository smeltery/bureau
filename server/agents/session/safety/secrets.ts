import { basename } from "path";

// ---------------------------------------------------------------------------
// Secrets protection — block reads of sensitive files
// ---------------------------------------------------------------------------

/** Exact basenames that are always sensitive */
const SENSITIVE_EXACT: Set<string> = new Set([".env", ".netrc", ".pgpass", ".my.cnf", "credentials.json", "service-account.json", "service_account.json"]);

/** Patterns matched against the basename */
const SENSITIVE_PATTERNS: RegExp[] = [
  /^\.env\./, // .env.local, .env.production, .env.development, etc.
  /\.pem$/, // TLS/SSH private keys
  /\.key$/, // private key files
  /\.p12$/, // PKCS#12 keystores
  /\.pfx$/, // PKCS#12 (Windows naming)
  /\.jks$/, // Java keystores
  /^id_rsa/, // SSH private keys (id_rsa, id_rsa.pub is harmless but block anyway)
  /^id_ed25519/, // SSH ed25519 keys
  /^id_ecdsa/, // SSH ECDSA keys
  /^id_dsa/, // SSH DSA keys
];

/** Bash commands that read file contents */
export const FILE_READ_COMMANDS = ["cat", "head", "tail", "less", "more", "bat", "batcat", "strings", "xxd", "hexdump", "od", "base64"];

/** Suffixes that indicate a template/example file, not real secrets */
const SAFE_SUFFIXES = [".example", ".template", ".sample", ".dist"];

export function isSensitiveFile(filePath: string): boolean {
  const name = basename(filePath);
  // Allow .env.example, .env.template, etc.
  if (SAFE_SUFFIXES.some((s) => name.endsWith(s))) return false;
  if (SENSITIVE_EXACT.has(name)) return true;
  return SENSITIVE_PATTERNS.some((p) => p.test(name));
}
