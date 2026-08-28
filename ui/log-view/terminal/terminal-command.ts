// Move to end of the current line, clear it, then type the reviewed command.
// This avoids appending repeated [Copy to terminal] clicks to stale prompt text.
export function commandInputBytes(command: string): string {
  return `\x05\x15${command}`;
}
