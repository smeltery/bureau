export interface ClipboardDocument {
  body: {
    appendChild(node: HTMLTextAreaElement): void;
    removeChild(node: HTMLTextAreaElement): void;
  };
  createElement(tagName: "textarea"): HTMLTextAreaElement;
  execCommand(command: "copy"): boolean;
}

export interface ClipboardNavigator {
  clipboard?: {
    writeText?: (text: string) => Promise<void>;
  };
}

function fallbackCopyText(text: string, doc: ClipboardDocument): boolean {
  const textarea = doc.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  doc.body.appendChild(textarea);
  textarea.select();
  try {
    return doc.execCommand("copy");
  } finally {
    doc.body.removeChild(textarea);
  }
}

export async function copyText(
  text: string,
  deps: {
    document?: ClipboardDocument;
    navigator?: ClipboardNavigator;
  } = {},
): Promise<boolean> {
  const nav = deps.navigator ?? (typeof navigator === "undefined" ? undefined : navigator);
  const doc = deps.document ?? (typeof document === "undefined" ? undefined : document);
  if (nav?.clipboard?.writeText) {
    try {
      await nav.clipboard.writeText(text);
      return true;
    } catch {
      // Clipboard API is often blocked outside secure/user-activation contexts.
    }
  }
  if (!doc) return false;
  try {
    return fallbackCopyText(text, doc);
  } catch {
    return false;
  }
}
