export interface PluginPromptPrefix {
  id: string;
  prefix: string;
}

export function applyPluginPrefixes(prefixes: PluginPromptPrefix[], sdkText: string): string {
  if (prefixes.length === 0) return sdkText;
  const blocks = prefixes.map(({ id, prefix }) => `--- begin plugin: ${id} ---\n${prefix}\n--- end plugin: ${id} ---`).join("\n\n");
  return `${blocks}\n\nUser message:\n${sdkText}`;
}

export function stripPluginPrefix(text: string): string {
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
