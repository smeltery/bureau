import { redactLogEntry } from "../persistence/logs/log-redaction.ts";

const MAX_LINE = 64 * 1024;
/** Keep incomplete lines private until their token boundaries are known. Long
 * lines are omitted entirely rather than publishing a potentially secret tail. */
export function createRecordingRedactor(write: (text: string) => void) {
  let pending = "";
  let omitting = false;
  function publish() {
    if (!omitting && pending) write(redactLogEntry({ text: pending }).text);
    pending = "";
  }
  return {
    push(text: string) {
      for (const part of text.split(/(?<=\n)/)) {
        if (!omitting) {
          pending += part;
          if (pending.length > MAX_LINE) {
            pending = "";
            omitting = true;
            write("[Long output line omitted]\r\n");
          }
        }
        if (part.endsWith("\n")) {
          publish();
          omitting = false;
        }
      }
    },
    finish: publish,
  };
}
