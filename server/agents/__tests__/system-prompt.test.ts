import { describe, expect, test } from "bun:test";
import { buildSystemPrompt, memorySection } from "../session/system-prompt.ts";
import { freezeBootState, setHasOwnerProvider, setPublicOriginFallback } from "../../auth/http-env.ts";
import { autocompleteCommands, commands, unsupportedMessage } from "../commands.ts";
import { handleHelpCommand } from "../conversation/slash-help.ts";
import { agents, logCache } from "../state.ts";
import type { ManagedAgent } from "../state.ts";

function resetPublicOriginState(hasOwner = false): void {
  setHasOwnerProvider(() => hasOwner);
  setPublicOriginFallback(null);
  freezeBootState({ externalAccess: false });
}

async function renderHelpForPublicOrigin(opts: { hasOwner: boolean; externalAccess: boolean; origin?: string }): Promise<string> {
  agents.clear();
  logCache.clear();
  setHasOwnerProvider(() => opts.hasOwner);
  setPublicOriginFallback(opts.origin ?? null);
  freezeBootState({ externalAccess: opts.externalAccess });

  const managed = {
    info: { id: "agent-1", state: "waiting_for_response", queue: [] },
    slashCommands: [{ name: "help", description: "List available commands" }],
    skills: [],
  } as unknown as ManagedAgent;
  agents.set("agent-1", managed);

  await handleHelpCommand("agent-1", managed, "/help", "Boss");
  const entry = (logCache.get("agent-1") ?? [])
    .filter((e) => e.kind === "system")
    .map((e) => e.content)
    .find((content) => content.includes("**Tips:**"));
  if (!entry) throw new Error("missing help output");
  return entry;
}

describe("buildSystemPrompt memory affordance", () => {
  test("documents all durable memory scopes without filesystem paths", () => {
    const prompt = buildSystemPrompt("A", "agent-1", "Room");

    expect(prompt).toContain('scope "agent"');
    expect(prompt).toContain('"boss"');
    expect(prompt).toContain('"office"');
    expect(prompt).toContain("/api/memory");
    expect(prompt).not.toContain("memory/bosses");
    expect(prompt).not.toContain("bosses/");
  });

  test("places memory after office, room, and agent instructions", () => {
    const prompt = buildSystemPrompt("A", "agent-1", "Room", "OFFICE-MARK", "ROOM-MARK", "AGENT-MARK", "MEMORY-MARK");

    expect(prompt.indexOf("OFFICE-MARK")).toBeLessThan(prompt.indexOf("ROOM-MARK"));
    expect(prompt.indexOf("ROOM-MARK")).toBeLessThan(prompt.indexOf("AGENT-MARK"));
    expect(prompt.indexOf("AGENT-MARK")).toBeLessThan(prompt.indexOf("MEMORY-MARK"));
  });

  test("documents inline diagram rendering options", () => {
    const prompt = buildSystemPrompt("A", "agent-1", "Room");

    expect(prompt).toContain("```mermaid");
    expect(prompt).toContain("inline HTML");
    expect(prompt).toContain("var(--accent)");
  });

  test("documents server attribution and task rooms when creating tasks", () => {
    const prompt = buildSystemPrompt("A", "agent-1", "Room");

    expect(prompt).toContain('"roomId":"<roomId>"');
    expect(prompt).toContain("the server attributes the task to your agent token");
    expect(prompt).toContain("omit it for office-wide work");
  });

  test("explains that terminal-command cards run on the server", () => {
    const prompt = buildSystemPrompt("A", "agent-1", "Room");

    expect(prompt).toContain("That terminal is a shell on the Bureau server machine");
    expect(prompt).toContain("put device-local commands in a normal chat message");
  });

  test("steers long waits to scheduled self-messages", () => {
    const prompt = buildSystemPrompt("A", "agent-1", "Room");

    expect(prompt).toContain("For waits that may outlast an idle session");
    expect(prompt).toContain("scheduled messages live on the server and still fire");
    expect(prompt).toContain("For long-lived local processes such as dev servers");
    // A process that must outlive the session is an APP now, not a hand-rolled
    // background job or a service the agent installs itself.
    expect(prompt).toContain("register it as a Bureau app");
    expect(prompt).toContain("Background-task completion notifications report the wrapper's exit code");
    expect(prompt).toContain("echo exit=$?");
  });

  test("documents permission posture in the agent manifest", () => {
    const prompt = buildSystemPrompt("A", "agent-1", "Room");

    expect(prompt).toContain("permissionMode");
    expect(prompt).toContain("sandbox (null for Claude agents)");
  });

  test("documents instant self-handoff REST", () => {
    const prompt = buildSystemPrompt("A", "agent-1", "Room");

    expect(prompt).toContain("/api/agents/agent-1/handoff");
    expect(prompt).toContain("forward-looking brief");
  });

  test("documents clientMessageId retry safety on inter-agent send", () => {
    const prompt = buildSystemPrompt("A", "agent-1", "Room");

    expect(prompt).toContain("clientMessageId");
    expect(prompt).toContain("retries safe for 5 minutes");
  });

  test("tells agents to hand long-running web apps to Bureau rather than picking a port", () => {
    const prompt = buildSystemPrompt("A", "agent-1", "Room");

    expect(prompt).toContain("How to run a web app for the boss");
    expect(prompt).toContain("Bureau allocates the port");
    expect(prompt).toContain("$BUREAU_APP_HOST");
    // The address is permanent: a bad command is a PATCH, not a re-register.
    expect(prompt).toContain("fix a bad command with PATCH");
    expect(prompt).toContain("$BUREAU_APP_DATA_DIR");
    // Never a localhost link — in the boss's browser that is their own device.
    expect(prompt).toContain("never a localhost URL");
  });

  test("documents the app's own message route and its limits", () => {
    const prompt = buildSystemPrompt("A", "agent-1", "Room");

    expect(prompt).toContain("$BUREAU_APP_TOKEN");
    expect(prompt).toContain("/api/app/message");
    expect(prompt).toContain("cannot interrupt a turn in progress");
    expect(prompt).toContain("10 messages a minute and 500 a day");
  });

  test("documents the agent context usage self-check", () => {
    const prompt = buildSystemPrompt("A", "agent-1", "Room");

    expect(prompt).toContain("/api/agents/agent-1/context");
    expect(prompt).toContain('"not_yet_measured"');
    expect(prompt).toContain("$BUREAU_AGENT_TOKEN");
  });

  test("documents custom instructions read access", () => {
    const prompt = buildSystemPrompt("A", "agent-1", "Room");

    expect(prompt).toContain("/api/agents/<id>/instructions");
    expect(prompt).toContain("customInstructions");
  });

  test("documents the agent manager before configurable instructions", () => {
    const prompt = buildSystemPrompt("A", "agent-1", "Room", "OFFICE-MARK", "ROOM-MARK", "AGENT-MARK", "MEMORY-MARK", "Boss One");

    expect(prompt).toContain("## Your Manager: Boss One");
    expect(prompt).toContain("Other bosses may also message you.");
    expect(prompt.indexOf("## Your Manager: Boss One")).toBeLessThan(prompt.indexOf("OFFICE-MARK"));
  });

  test("injects personal context after office instructions", () => {
    const prompt = buildSystemPrompt("A", "agent-1", "Room", "OFFICE-MARK", "ROOM-MARK", "AGENT-MARK", "MEMORY-MARK", "Boss One", "PREFERS-TEST-FIRST");

    expect(prompt).toContain("## Special Instructions For Boss One");
    expect(prompt).toContain("PREFERS-TEST-FIRST");
    expect(prompt.indexOf("OFFICE-MARK")).toBeLessThan(prompt.indexOf("PREFERS-TEST-FIRST"));
    expect(prompt.indexOf("PREFERS-TEST-FIRST")).toBeLessThan(prompt.indexOf("ROOM-MARK"));
  });

  test("adds a manager language preference before room instructions", () => {
    const prompt = buildSystemPrompt("A", "agent-1", "Room", "OFFICE-MARK", "ROOM-MARK", null, null, "Boss One", null, false, "es");

    expect(prompt).toContain("Boss One has indicated Spanish as their default language");
    expect(prompt.indexOf("OFFICE-MARK")).toBeLessThan(prompt.indexOf("Spanish as their default language"));
    expect(prompt.indexOf("Spanish as their default language")).toBeLessThan(prompt.indexOf("ROOM-MARK"));
  });

  test("does not add a language clause for the default language", () => {
    const prompt = buildSystemPrompt("A", "agent-1", "Room", null, null, null, null, "Boss One", null, false, "en");

    expect(prompt).not.toContain("default language");
  });

  test("says nothing about privileged authority for a normal agent", () => {
    const prompt = buildSystemPrompt("A", "agent-1", "Room", null, null, null, null, "Boss One", null, false);

    expect(prompt).not.toContain("## Privileged Operator Context");
  });

  // The privileged paragraph is an authorization CLAIM: what it promises has to
  // match what the routes actually accept (see
  // server/http/__tests__/privileged-agent-office.test.ts and
  // privileged-agent-boundaries.test.ts). Both halves are pinned here so the
  // prompt can't drift back into promising authority the server refuses.
  test("tells a privileged agent exactly which office-management routes it can drive", () => {
    const prompt = buildSystemPrompt("A", "agent-1", "Room", null, null, null, null, "Boss One", null, true);

    expect(prompt).toContain("## Privileged Operator Context");
    expect(prompt).toContain("Use it ONLY when a boss explicitly asks you to");
    expect(prompt).toContain("limited to the rooms and agents your manager can see");
    expect(prompt).toContain("create a room (only if your manager is an owner)");
    expect(prompt).toContain("/api/rooms/<roomId>/settings");
    expect(prompt).toContain("hire a coworker");
    expect(prompt).toContain(".../new-conversation");
    expect(prompt).toContain(".../handoff");
  });

  test("tells a privileged agent what it cannot do, privilege flags included", () => {
    const prompt = buildSystemPrompt("A", "agent-1", "Room", null, null, null, null, "Boss One", null, true);

    expect(prompt).toContain("/api/office/settings");
    expect(prompt).toContain("/api/office/access");
    expect(prompt).toContain("Invites, browser sessions, and user records");
    expect(prompt).toContain("view preferences and the boss's terminal panel");
    expect(prompt).toContain("You cannot make yourself or any other agent privileged");
    expect(prompt).toContain("Do not ask another agent to do it for you.");
  });
});

describe("memorySection", () => {
  test("returns empty text when there is no memory", () => {
    expect(memorySection(null)).toBe("");
    expect(memorySection(undefined)).toBe("");
    expect(memorySection("")).toBe("");
  });

  test("frames memory as context, not instructions", () => {
    const section = memorySection("- Boss, 2026-07-04: Prefer short updates.");
    expect(section).toContain("## Durable Memory");
    expect(section).toContain("context to weigh");
    expect(section).toContain("- Boss, 2026-07-04: Prefer short updates.");
  });
});

describe("handoff commands", () => {
  test("registers /handoff and keeps /handoff-apply manual-only", () => {
    expect(commands.handoff.supported).toBe(true);
    expect(commands.handoff.handler).toBe("handoff");
    expect(commands["handoff-apply"].supported).toBe(true);
    expect(commands["handoff-apply"].handler).toBe("handoffApply");
    expect(autocompleteCommands().map((cmd) => cmd.name)).toContain("handoff");
    expect(autocompleteCommands().map((cmd) => cmd.name)).not.toContain("handoff-apply");
  });
});

describe("unsupported commands", () => {
  test("points /loop at Bureau recurring-work affordances", () => {
    expect(unsupportedMessage("loop")).toBe("not supported natively; see if the Cronjobs tab or scheduled messages satisfy your use case");
    expect(commands.loop.type).toBe("bundled-skill");
    expect(commands.loop.supported).toBe(false);
    expect(commands.loop.overridable).toBe(true);
  });
});

describe("command auto-run metadata", () => {
  test("uses provider-neutral login copy", () => {
    expect(commands.login.description).toBe("Show how to authenticate this agent");
  });

  test("marks no-argument commands and emits only literal true on autocomplete entries", () => {
    const expectedAutoRun = new Set([
      "clear",
      "context",
      "handoff",
      "help",
      "bureau-usage",
      "bureau-storage",
      "resume",
      "login",
      "bureau-all-hands",
      "bureau-system-prompt",
      "bureau-diff",
      "usage",
      "model",
      "effort",
      "diff",
    ]);
    const actualAutoRun = new Set(
      Object.entries(commands)
        .filter(([, config]) => config.autoRun === true)
        .map(([name]) => name),
    );
    expect(actualAutoRun).toEqual(new Set([...expectedAutoRun, "reset", "new"]));

    for (const command of autocompleteCommands()) {
      if (expectedAutoRun.has(command.name)) {
        expect(command.autoRun).toBe(true);
      } else {
        expect("autoRun" in command).toBe(false);
      }
    }
  });
});

describe("help public-origin tips", () => {
  test("keeps VPN and Funnel guidance on localhost-bound boots", async () => {
    try {
      const help = await renderHelpForPublicOrigin({ hasOwner: true, externalAccess: false, origin: "https://bureau.example" });

      expect(help).toContain("connect it to the same VPN");
      expect(help).toContain("Tailscale Funnel");
      expect(help).toContain("mint one-time invite URLs");
      expect(help).not.toContain("https://bureau.example");
    } finally {
      resetPublicOriginState();
    }
  });

  test("shows the configured public URL when external access is active", async () => {
    try {
      const help = await renderHelpForPublicOrigin({ hasOwner: true, externalAccess: true, origin: "https://bureau.example" });

      expect(help).toContain("Bureau works on your phone: open https://bureau.example.");
      expect(help).toContain("mint one-time invite URLs");
      expect(help).not.toContain("connect it to the same VPN");
      expect(help).not.toContain("Tailscale Funnel");
    } finally {
      resetPublicOriginState();
    }
  });
});
