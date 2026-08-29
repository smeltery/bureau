// File attachment metadata
export interface Attachment {
  filename: string; // on-disk hash name: "a1b2c3.png"
  originalName: string; // user-facing: "photo.png"
  mediaType: string; // "image/png", "application/pdf", etc.
  size: number; // bytes
}

// Per-file summary inside a kind:"diff" LogEntry. The server pre-computes
// inlineEligible so the client doesn't re-parse the patch to decide rendering.
export interface DiffFileSummary {
  path: string;
  oldPath?: string; // set on rename / copy
  status: "added" | "modified" | "deleted" | "renamed" | "copied" | "untracked" | "binary";
  additions: number;
  deletions: number;
  lineCount: number; // approx size of the per-file patch (additions + deletions)
  inlineEligible: boolean; // server-computed: lineCount <= 500 && !binary && patch present
}

// Structured payload attached to LogEntry when kind === "diff".
export interface DiffPayload {
  cwd: string;
  branch: string | null; // null on detached HEAD or fresh repo
  head: string | null; // short SHA, null on fresh repo with no commits
  // Present when the diff targets a specific commit/range rather than the
  // working tree. Single commits use the commit subject; ranges use the
  // literal range string. Optional for persisted pre-existing diff entries.
  subject?: string | null;
  stats: { additions: number; deletions: number; filesChanged: number };
  files: DiffFileSummary[];
  patchText: string | null; // null when over 2MB safety rail
  truncated: boolean; // true when patchText was dropped
}

// Structured payload attached to LogEntry when kind === "edit-request".
// Emitted by POST /api/agents/:id/edit-file. The card surfaces an
// [Open in editor] button that opens the file in the editor side panel.
export interface FilePayload {
  path: string; // resolved absolute path
}

// Structured payload attached to LogEntry when kind === "terminal-command".
// Emitted by POST /api/agents/:id/terminal-command. The card surfaces a
// [Copy to terminal] button that opens the terminal side panel and types
// the command at the prompt without executing it (boss presses Enter).
export interface TerminalCommandPayload {
  command: string; // single-line shell command
}

export interface ChoicePromptChoice {
  value: string;
  label: string;
  description?: string;
  current?: boolean;
}

export interface ChoicePromptPayload {
  kind: "resume" | "model" | "effort";
  title: string;
  instruction: string;
  choices: ChoicePromptChoice[];
}

// Which loop a tool call came from, when it was NOT the agent's own. A
// subagent (Claude's Agent/Task tool) runs its own tool calls, and the SDK
// forwards them on the same stream as the parent's — so an unmarked transcript
// reads as one flat run with no way to tell who made a call. Rides as
// `metadata.subagent` on tool_call / tool_result entries and is simply absent
// on the agent's own calls, on Codex, and on entries written before it existed.
//
// `parentToolUseId` is the id of the Agent/Task call that spawned the
// subagent — the join back to the parent card. `type` and `description` are
// the SDK's labels for the subagent and its assignment (model-authored free
// text, sanitized to one capped line by the backend); older SDKs omit both.
export interface SubagentOrigin {
  parentToolUseId: string;
  type?: string;
  description?: string;
}

// Log entry in the conversation view
export interface LogEntry {
  id: string;
  agentId: string;
  timestamp: number;
  kind: "text" | "thinking" | "tool_call" | "tool_result" | "error" | "system" | "user_message" | "diff" | "edit-request" | "terminal-command" | "file-view";
  content: string;
  metadata?: Record<string, unknown> & { choicePrompt?: ChoicePromptPayload };
  ephemeral?: boolean;
  attachments?: Attachment[]; // file attachments, served via /api/files/<agentId>/<filename>
  diff?: DiffPayload; // present only when kind === "diff"
  file?: FilePayload; // present only when kind === "edit-request"
  terminal?: TerminalCommandPayload; // present only when kind === "terminal-command"
}
