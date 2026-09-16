import { describe, expect, test } from "bun:test";
import { handleHelpCommand } from "../conversation/slash-help.ts";
import { agents, logCache } from "../state.ts";
import type { ManagedAgent } from "../state.ts";

function managedWithSkills(): ManagedAgent {
  return {
    info: { id: "agent-1", state: "waiting_for_response", queue: [] },
    slashCommands: [
      { name: "help", description: "List available commands" },
      { name: "diff", description: "Show a styled diff", aliasFor: "bureau-diff" },
      { name: "bureau-diff", description: "Show a styled diff" },
    ],
    skills: [
      { name: "peer", description: "Ask a peer", origin: "bureau" },
      { name: "mine", description: "User skill", origin: "user" },
      { name: "proj", description: "Project skill", origin: "project" },
    ],
  } as unknown as ManagedAgent;
}

async function runHelp(): Promise<{ content: string; helpContent: string }> {
  agents.clear();
  logCache.clear();
  const managed = managedWithSkills();
  agents.set("agent-1", managed);
  await handleHelpCommand("agent-1", managed, "/help", "Boss");
  const entry = (logCache.get("agent-1") ?? []).find((e) => e.kind === "system" && typeof e.metadata?.helpContent === "string");
  if (!entry || typeof entry.metadata?.helpContent !== "string") throw new Error("missing help card entry");
  return { content: entry.content, helpContent: entry.metadata.helpContent };
}

describe("handleHelpCommand", () => {
  test("emits a compact Help card with body in metadata", async () => {
    const { content, helpContent } = await runHelp();
    expect(content).toBe("**Help**");
    expect(helpContent).toContain("**Docs:** https://github.com/smeltery/bureau/tree/master/docs");
    expect(helpContent).toContain("## Commands you can type");
    expect(helpContent).toContain("`/diff` (or `/bureau-diff`)");
    expect(helpContent).not.toContain("**Tips:**\n**Commands:**");
  });

  test("leads with docs and short tips; omits phone/device sprawl", async () => {
    const { helpContent } = await runHelp();
    expect(helpContent.startsWith("**Docs:**")).toBe(true);
    expect(helpContent).toContain("**Tips:**");
    expect(helpContent).toContain("ctrl+space");
    expect(helpContent).not.toContain("works on your phone");
    expect(helpContent).not.toContain("Tailscale Funnel");
    expect(helpContent).not.toContain("mint one-time invite");
    expect(helpContent).not.toContain("Receptionist");
  });

  test("groups skills into Bureau Skills and User Skills", async () => {
    const { helpContent } = await runHelp();
    expect(helpContent).toContain("## Bureau Skills");
    expect(helpContent).toContain("`/peer`");
    expect(helpContent).toContain("## User Skills");
    expect(helpContent).toContain("`/mine`");
    expect(helpContent).toContain("`/proj`");
    expect(helpContent).not.toContain("**User skills:**");
    expect(helpContent).not.toContain("**Project skills:**");
  });
});
