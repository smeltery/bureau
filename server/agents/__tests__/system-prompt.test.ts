import { describe, expect, test } from "bun:test";
import { buildSystemPrompt, memorySection } from "../session/system-prompt.ts";

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

  test("documents boss attribution when creating tasks", () => {
    const prompt = buildSystemPrompt("A", "agent-1", "Room");

    expect(prompt).toContain('"createdBy":"<boss-name>"');
    expect(prompt).toContain('If you can\'t tell, use "A".');
  });

  test("documents the agent manager before configurable instructions", () => {
    const prompt = buildSystemPrompt("A", "agent-1", "Room", "OFFICE-MARK", "ROOM-MARK", "AGENT-MARK", "MEMORY-MARK", "Boss One");

    expect(prompt).toContain("## Your Manager: Boss One");
    expect(prompt).toContain("Other bosses may also message you.");
    expect(prompt.indexOf("## Your Manager: Boss One")).toBeLessThan(prompt.indexOf("OFFICE-MARK"));
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
