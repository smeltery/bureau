import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { Webhook, WebhookDelivery } from "../../shared/integrations/webhooks.ts";
import { BUREAU_DIR } from "../persistence/paths.ts";

export const WEBHOOK_DIR = join(BUREAU_DIR, "webhooks");
const CONFIG = join(WEBHOOK_DIR, "hooks.json");
const SECRETS = join(WEBHOOK_DIR, "secrets.json");
const LEDGER = join(WEBHOOK_DIR, "deliveries.json");
const REPLAY_WINDOW = 7 * 86_400_000;
type Receipt = WebhookDelivery & { digest: string };

function read<T>(path: string, fallback: T): T {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : fallback;
}
function write(path: string, value: unknown): void {
  mkdirSync(WEBHOOK_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(path + ".tmp", JSON.stringify(value), { mode: 0o600 });
  renameSync(path + ".tmp", path);
}
export function listWebhooks(): Webhook[] {
  return read<Webhook[]>(CONFIG, []);
}
export function webhookSecret(id: string): string | undefined {
  return read<Record<string, string>>(SECRETS, {})[id];
}
export function saveWebhook(hook: Webhook): void {
  write(CONFIG, [...listWebhooks().filter((item) => item.id !== hook.id), hook]);
}
export function rotateWebhookSecret(id: string): string {
  const secrets = read<Record<string, string>>(SECRETS, {});
  const secret = randomBytes(32).toString("hex");
  secrets[id] = secret;
  write(SECRETS, secrets);
  return secret;
}
export function deleteWebhook(id: string): void {
  write(
    CONFIG,
    listWebhooks().filter((hook) => hook.id !== id),
  );
  const secrets = read<Record<string, string>>(SECRETS, {});
  delete secrets[id];
  write(SECRETS, secrets);
  const ledger = read<Record<string, Receipt[]>>(LEDGER, {});
  delete ledger[id];
  write(LEDGER, ledger);
}
export function listDeliveries(id: string): WebhookDelivery[] {
  return (read<Record<string, Receipt[]>>(LEDGER, {})[id] ?? [])
    .slice(-200)
    .reverse()
    .map(({ digest: _digest, ...row }) => row);
}
/** Persist the claim before dispatch. A crash leaves an explicit pending receipt,
 * never a silent second dispatch. Both body hashes and delivery ids dedupe. */
export function claimDelivery(hookId: string, row: Receipt): boolean {
  const ledger = read<Record<string, Receipt[]>>(LEDGER, {});
  const rows = (ledger[hookId] ?? []).filter((item) => item.at > row.at - REPLAY_WINDOW);
  if (rows.some((item) => item.id === row.id || item.digest === row.digest)) return false;
  if (rows.length >= 10_000) throw new Error("delivery capacity reached");
  ledger[hookId] = [...rows, row];
  write(LEDGER, ledger);
  return true;
}
export function finishDelivery(hookId: string, id: string, patch: Partial<WebhookDelivery>): void {
  const ledger = read<Record<string, Receipt[]>>(LEDGER, {});
  const row = ledger[hookId]?.find((item) => item.id === id);
  if (!row) throw new Error("missing delivery receipt");
  Object.assign(row, patch);
  write(LEDGER, ledger);
}
