// The Apps tab's two shared bits of styling: the small outline button every verb
// uses, and the monospace pane the log and the start error render in.

import type { CSSProperties } from "react";

export function appBtnStyle(danger: boolean, disabled: boolean): CSSProperties {
  return {
    padding: "4px 10px",
    borderRadius: 6,
    border: `1px solid ${danger ? "var(--red)" : "var(--border)"}`,
    background: "transparent",
    color: danger ? "var(--red)" : "var(--text-secondary)",
    fontSize: 11,
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.5 : 1,
  };
}

export const appMonoPane: CSSProperties = {
  padding: "6px 8px",
  borderRadius: 6,
  background: "var(--bg-code, var(--bg-base))",
  fontSize: 11,
  fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
  overflowWrap: "anywhere",
};
