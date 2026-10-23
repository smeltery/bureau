import { displayLogContent, displayLogText } from "../../../shared/i18n/log-message.ts";
import { commands } from "../commands.ts";
import { afterEach, describe, expect, test } from "bun:test";
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

  test("links to the skills library without duplicating its inventory", async () => {
    const { helpContent } = await runHelp();
    expect(helpContent).toContain("[Skills library](/skills)");
    expect(helpContent).not.toContain("`/peer`");
    expect(helpContent).not.toContain("## User Skills");
    expect(helpContent).not.toContain("`/mine`");
    expect(helpContent).not.toContain("`/proj`");
    expect(helpContent).not.toContain("**User skills:**");
    expect(helpContent).not.toContain("**Project skills:**");
  });
});

afterEach(() => {
  agents.clear();
  logCache.clear();
});

test("help translates built-ins and aliases while keeping overrides and custom text", async () => {
  const managed = managedWithSkills();
  managed.slashCommands = [
    { name: "help", description: commands.help.description },
    { name: "diff", description: commands.diff.description, aliasFor: "bureau-diff" },
    { name: "bureau-diff", description: commands["bureau-diff"].description },
    { name: "review", description: commands.review.description },
    { name: "clear", description: "Custom clear description" },
    { name: "custom", description: "Custom skill description" },
  ];
  managed.skills.push({ name: "review", description: commands.review.description, origin: "user" });
  agents.set("agent-1", managed);
  await handleHelpCommand("agent-1", managed, "/help", "Boss");
  const original = logCache.get("agent-1")!.at(-1)!;
  const entry = JSON.parse(JSON.stringify(original));
  const spanish = displayLogText(entry.metadata.helpContent, entry.metadata.helpMessage, "es");
  expect(displayLogContent(entry, "es")).toBe("**Ayuda**");
  expect(spanish).toContain("**Documentación:**");
  expect(spanish).toContain("`/help` — Listar todos los comandos disponibles");
  expect(spanish).toContain("`/diff` (o `/bureau-diff`) — Ver cambios sin confirmar");
  expect(spanish).toContain(`\`/review\` — ${commands.review.description}`);
  expect(spanish).toContain("Custom clear description");
  expect(spanish).toContain("Custom skill description");
  expect(spanish).toContain("`/bureau-message <agent> <text>`");
  expect(spanish).toContain("`/bureau-edit <path>`");
  expect(entry.metadata.helpContent).toContain("**Docs:**");
  expect(displayLogText("Legacy help", { key: "logs.futureHelp" }, "zh")).toBe("Legacy help");
});
