export interface PluginPromptPrefix {
  id: string;
  prefix: string;
}

// The reserved delimiter the wake notice travels in. Named for Bureau itself,
// NOT a fake plugin id: it's server coordination, absent from plugin discovery
// and failure accounting. Having its own delimiter is what lets
// stripPluginPrefix round-trip it for edit-to-fork matching.
export const WAKE_NOTICE_BLOCK_OPEN = "--- begin bureau: wake-notice ---";
export const WAKE_NOTICE_BLOCK_CLOSE = "--- end bureau: wake-notice ---";

export function formatWakeNoticeBlock(note: string): string {
  return `${WAKE_NOTICE_BLOCK_OPEN}\n${note}\n${WAKE_NOTICE_BLOCK_CLOSE}`;
}

export function applyPluginPrefixes(prefixes: PluginPromptPrefix[], sdkText: string): string {
  if (prefixes.length === 0) return sdkText;
  const blocks = prefixes.map(({ id, prefix }) => `--- begin plugin: ${id} ---\n${prefix}\n--- end plugin: ${id} ---`).join("\n\n");
  return `${blocks}\n\nUser message:\n${sdkText}`;
}

// Inverse of the outbound envelope, used by edit-to-fork to find the SDK user
// message that corresponds to a Bureau log entry. Plugin blocks come off first
// (they sit ahead of the `User message:` separator), then the built-in wake
// block, which is the first thing inside the payload.
export function stripPluginPrefix(text: string): string {
  return stripWakeNoticeBlock(stripPluginBlocks(text));
}

function stripWakeNoticeBlock(text: string): string {
  if (!text.startsWith(`${WAKE_NOTICE_BLOCK_OPEN}\n`)) return text;
  const close = `\n${WAKE_NOTICE_BLOCK_CLOSE}\n\n`;
  const end = text.indexOf(close);
  if (end < 0) return text;
  return text.slice(end + close.length);
}

function stripPluginBlocks(text: string): string {
  if (!text.startsWith("--- begin plugin: ")) return text;
  let offset = 0;
  while (text.startsWith("--- begin plugin: ", offset)) {
    const endMatch = text.slice(offset).match(/\n--- end plugin: [^\n]+ ---\n\n/);
    if (!endMatch || endMatch.index === undefined) return text;
    offset += endMatch.index + endMatch[0].length;
  }
  const marker = "User message:\n";
  if (!text.startsWith(marker, offset)) return text;
  return text.slice(offset + marker.length);
}
