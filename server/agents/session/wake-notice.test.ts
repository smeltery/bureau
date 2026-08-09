// A SIGTERMed Claude CLI hands the resumed model hardcoded text claiming the
// USER rejected the tool that was running, so the agent wakes up believing its
// boss countermanded it. The wake-up message has to say what actually happened —
// and only what it can prove.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { DEFAULT_AGENT_CAPABILITIES, type AgentBackendType, type AgentInfo } from "../../../shared/types.ts";
import { createManagedAgent } from "../managed-factory.ts";
import { agents, type ManagedAgent } from "../state.ts";
import { mintAgentToken, revokeAgentToken } from "../tokens.ts";
import { claudeProjectDir } from "./paths.ts";
import { claudeSessionInterruptedByShutdown } from "./shutdown-marker.ts";
import { armDormantWakeNotice, dormantWakeMessage } from "./wake-notice.ts";

// Phrases the wake-up message is built from. Kept as constants so a reworded
// message fails these tests loudly instead of silently passing a stale check.
const WAKE_RESTART = "Resumed your session after the server restarted.";
const WAKE_STREAM_END = "Resumed your session after the backend ended unexpectedly.";
const WAKE_PARTIAL = "Any command that was in flight may have partially run; verify its effects before retrying.";
const WAKE_CATEGORICAL = "is from the shutdown, not a human";
// The rejection clause appears ONLY when the transcript proves the shutdown (do
// not explain a rejection that may not be there), so unproven wakes must carry
// no rejection wording at all.
const WAKE_REJECTION_TALK = "reject";

// A transcript whose last entry carries the SIGTERM marker the Claude CLI
// stamps when it cuts a turn short — the entry whose tool result claims the
// user rejected the running tool.
const SHUTDOWN_TRANSCRIPT =
  JSON.stringify({ type: "user", interruptedByShutdown: false }) +
  "\n" +
  JSON.stringify({ type: "user", interruptedByShutdown: true, message: { content: [{ type: "tool_result", content: "user rejected" }] } }) +
  "\n";

let claudeHome: string;
let workCwd: string;
const AGENT_ID = "agent-wake-notice";

function seedClaudeSession(cwd: string, sessionId: string, content: string): void {
  const dir = claudeProjectDir(cwd, { CLAUDE_CONFIG_DIR: claudeHome });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${sessionId}.jsonl`), content);
}

function markerEnv() {
  return { CLAUDE_CONFIG_DIR: claudeHome };
}

// buildSessionEnv (which the wake message consults for CLAUDE_CONFIG_DIR) only
// returns a merged env when the agent has something to merge, so the minted
// agent token is what carries the test's config dir through to the lookup.
function makeManaged(agentType: AgentBackendType = "claude"): ManagedAgent {
  const info: AgentInfo = {
    id: AGENT_ID,
    name: "Waker",
    desk: 0,
    room: 0,
    cwd: workCwd,
    outfit: { hat: "none", color: "#000000", hair: "#000000", hairStyle: "short", skin: "#000000", beard: "none", accessory: null },
    permissionMode: "default",
    modelFamily: "sonnet",
    agentType,
    capabilities: DEFAULT_AGENT_CAPABILITIES,
    state: "waiting_for_response",
    topic: null,
    topicStale: false,
    customInstructions: null,
  };
  const managed = createManagedAgent({ info, skillCwd: workCwd, slashCommands: [], skills: [] });
  mintAgentToken(AGENT_ID, null, false);
  return managed;
}

beforeEach(() => {
  claudeHome = mkdtempSync(join(tmpdir(), "bureau-wake-home-"));
  workCwd = mkdtempSync(join(tmpdir(), "bureau-wake-cwd-"));
  process.env.CLAUDE_CONFIG_DIR = claudeHome;
});

afterEach(() => {
  delete process.env.CLAUDE_CONFIG_DIR;
  revokeAgentToken(AGENT_ID);
  agents.clear();
  rmSync(claudeHome, { recursive: true, force: true });
  rmSync(workCwd, { recursive: true, force: true });
});

describe("claudeSessionInterruptedByShutdown", () => {
  test("true only when the marker is on the LAST entry", () => {
    seedClaudeSession(workCwd, "sid-proven", SHUTDOWN_TRANSCRIPT);
    expect(claudeSessionInterruptedByShutdown(workCwd, "sid-proven", markerEnv())).toBe(true);
  });

  test("ignores a marker that is not on the last entry", () => {
    // The marker belongs to the entry the shutdown cut short. An older one
    // describes a previous death the agent has already been told about.
    seedClaudeSession(workCwd, "sid-old", JSON.stringify({ type: "user", interruptedByShutdown: true }) + "\n" + JSON.stringify({ type: "assistant" }) + "\n");
    expect(claudeSessionInterruptedByShutdown(workCwd, "sid-old", markerEnv())).toBe(false);
  });

  test("false for a clean transcript and for a truncated final line", () => {
    seedClaudeSession(workCwd, "sid-clean", '{"type":"user"}\n');
    expect(claudeSessionInterruptedByShutdown(workCwd, "sid-clean", markerEnv())).toBe(false);
    // Best-effort means non-load-bearing: a truncated/garbage final line is
    // indeterminate, never a crash and never a guessed true.
    seedClaudeSession(workCwd, "sid-torn", '{"type":"user"}\n{"interruptedBySh');
    expect(claudeSessionInterruptedByShutdown(workCwd, "sid-torn", markerEnv())).toBe(false);
  });

  test("false for a missing or empty file", () => {
    expect(claudeSessionInterruptedByShutdown(workCwd, "sid-absent", markerEnv())).toBe(false);
    seedClaudeSession(workCwd, "sid-empty", "");
    expect(claudeSessionInterruptedByShutdown(workCwd, "sid-empty", markerEnv())).toBe(false);
  });

  test("reads the marker from the tail of a large transcript", () => {
    seedClaudeSession(workCwd, "sid-big", `${JSON.stringify({ type: "assistant", pad: "p".repeat(400_000) })}\n${SHUTDOWN_TRANSCRIPT}`);
    expect(claudeSessionInterruptedByShutdown(workCwd, "sid-big", markerEnv())).toBe(true);
  });
});

describe("dormantWakeMessage", () => {
  test("idle eviction says nothing about shutdowns and costs the agent no context", () => {
    // The calm branch must not inherit the alarm: nothing was interrupted.
    seedClaudeSession(workCwd, "sid", SHUTDOWN_TRANSCRIPT);
    const wake = dormantWakeMessage(makeManaged(), "idle", "sid");
    expect(wake.log).toContain("released while idle");
    expect(wake.log).not.toContain(WAKE_PARTIAL);
    expect(wake.log).not.toContain(WAKE_REJECTION_TALK);
    expect(wake.note).toBeNull();
  });

  test("restart wake: warns about partial effects, NO rejection clause unproven", () => {
    // No shutdown marker on disk, so Bureau cannot prove a rejection was
    // synthetic — and explaining a rejection that may not exist is noise.
    seedClaudeSession(workCwd, "sid", '{"type":"user"}\n');
    const wake = dormantWakeMessage(makeManaged(), "boot", "sid");
    expect(wake.log).toContain(WAKE_RESTART);
    expect(wake.log).toContain(WAKE_PARTIAL);
    expect(wake.log).not.toContain(WAKE_REJECTION_TALK);
    // The whole point: the AGENT is told, not just the human reading the log.
    expect(wake.note).toBe(wake.log);
  });

  test("restart wake: adds the CATEGORICAL clause when the transcript proves it", () => {
    seedClaudeSession(workCwd, "sid", SHUTDOWN_TRANSCRIPT);
    const wake = dormantWakeMessage(makeManaged(), "boot", "sid");
    expect(wake.log).toContain(WAKE_RESTART);
    expect(wake.log).toContain(WAKE_PARTIAL);
    expect(wake.log).toContain(WAKE_CATEGORICAL);
    expect(wake.note).toBe(wake.log);
  });

  test("backend-death wake: same warning, worded for an unexpected end", () => {
    seedClaudeSession(workCwd, "sid", SHUTDOWN_TRANSCRIPT);
    const wake = dormantWakeMessage(makeManaged(), "session-ended", "sid");
    expect(wake.log).toContain(WAKE_STREAM_END);
    expect(wake.log).toContain(WAKE_PARTIAL);
    expect(wake.log).toContain(WAKE_CATEGORICAL);
  });

  test("no clause for a Codex agent even with a marked transcript", () => {
    // interruptedByShutdown is a Claude CLI artifact; a Codex agent's rollout
    // never carries it, so the clause would be an unproven claim.
    seedClaudeSession(workCwd, "sid", SHUTDOWN_TRANSCRIPT);
    const wake = dormantWakeMessage(makeManaged("codex"), "session-ended", "sid");
    expect(wake.log).toContain(WAKE_STREAM_END);
    expect(wake.log).toContain(WAKE_PARTIAL);
    expect(wake.log).not.toContain(WAKE_REJECTION_TALK);
  });

  test("unreadable transcript stays clause-free instead of throwing", () => {
    const wake = dormantWakeMessage(makeManaged(), "boot", "sid-never-written");
    expect(wake.log).toContain(WAKE_PARTIAL);
    expect(wake.log).not.toContain(WAKE_REJECTION_TALK);
  });
});

describe("armDormantWakeNotice", () => {
  test("arms the slot on a warning wake and returns the identical log line", () => {
    seedClaudeSession(workCwd, "sid", SHUTDOWN_TRANSCRIPT);
    const managed = makeManaged();
    const logLine = armDormantWakeNotice(managed, "boot", "sid");
    expect(managed.wakeNotice).toBe(logLine);
  });

  test("leaves the slot empty on an idle wake", () => {
    seedClaudeSession(workCwd, "sid", SHUTDOWN_TRANSCRIPT);
    const managed = makeManaged();
    managed.wakeNotice = "stale";
    const logLine = armDormantWakeNotice(managed, "idle", "sid");
    expect(logLine).toContain("released while idle");
    expect(managed.wakeNotice).toBeNull();
  });
});
