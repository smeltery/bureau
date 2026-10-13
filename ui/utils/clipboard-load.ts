import { copyText } from "./clipboard.ts";

// Start the clipboard write inside the click gesture, before the network resolves.
export async function copyLoadedText(
  load: () => Promise<string>,
  deps: {
    write?: (items: ClipboardItem[]) => Promise<void>;
    item?: typeof ClipboardItem;
    fallback?: (text: string) => Promise<boolean>;
  } = {},
): Promise<boolean> {
  const write = deps.write ?? globalThis.navigator?.clipboard?.write?.bind(globalThis.navigator.clipboard);
  const Item = deps.item ?? globalThis.ClipboardItem;
  const text = load();
  if (write && Item) {
    const blob = text.then((value) => new Blob([value], { type: "text/plain" }));
    // A constructor/write rejection may leave the content promise unobserved.
    void blob.catch(() => {});
    try {
      await write([new Item({ "text/plain": blob })]);
      return true;
    } catch {
      // Fall through for browsers that do not support promised clipboard data.
    }
  }
  return (deps.fallback ?? copyText)(await text);
}
