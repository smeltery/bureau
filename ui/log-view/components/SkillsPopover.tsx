import { useEffect, useMemo, useRef, useState } from "react";
import type { SkillInfo, SkillOrigin } from "../../../shared/types.ts";

export interface CommandEntry {
  name: string;
  description?: string;
  aliasFor?: string;
}

type GroupKey = "commands" | "bundled" | "user" | "project" | "plugin";

const GROUP_ORDER: GroupKey[] = ["commands", "bundled", "user", "project", "plugin"];

const GROUP_LABELS: Record<GroupKey, string> = {
  commands: "Commands",
  bundled: "Bundled",
  user: "User",
  project: "Project",
  plugin: "Plugin",
};

function groupForOrigin(origin: SkillOrigin): GroupKey {
  if (origin === "bureau" || origin === "claude") return "bundled";
  return origin;
}

export function SkillsPopover({
  skills,
  commands,
  isMobile,
  onPick,
  onClose,
}: {
  skills: SkillInfo[];
  commands: CommandEntry[];
  isMobile: boolean;
  onPick: (name: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    function handlePointerDown(e: PointerEvent | TouchEvent) {
      const target = e.target as Element | null;
      if (!target) return;
      if (ref.current?.contains(target)) return;
      if (target.closest("[data-skills-toggle]")) return;
      onClose();
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("touchstart", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("touchstart", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [onClose]);

  useEffect(() => {
    if (!isMobile) filterRef.current?.focus();
  }, [isMobile]);

  const groups = useMemo(() => {
    const aliasTargets = new Set([...skills, ...commands].filter((entry) => entry.aliasFor).map((entry) => entry.aliasFor as string));
    const q = filter.trim().toLowerCase();
    const matches = (name: string, description?: string) => !q || name.toLowerCase().includes(q) || (description ?? "").toLowerCase().includes(q);
    const byGroup = new Map<GroupKey, { name: string; description?: string }[]>();
    const add = (group: GroupKey, name: string, description?: string) => {
      if (aliasTargets.has(name) || !matches(name, description)) return;
      const list = byGroup.get(group) ?? [];
      list.push({ name, description });
      byGroup.set(group, list);
    };

    for (const command of commands) add("commands", command.name, command.description);
    for (const skill of skills) add(groupForOrigin(skill.origin), skill.name, skill.description);

    return GROUP_ORDER.filter((group) => byGroup.has(group)).map((group) => ({
      key: group,
      label: GROUP_LABELS[group],
      entries: byGroup.get(group)!.sort((a, b) => a.name.localeCompare(b.name)),
    }));
  }, [commands, filter, skills]);

  return (
    <div
      ref={ref}
      style={{
        position: "absolute",
        bottom: "100%",
        left: 8,
        right: isMobile ? 8 : 20,
        marginBottom: 4,
        background: "var(--bg-surface-solid)",
        border: "1px solid var(--border-medium)",
        borderRadius: 8,
        boxShadow: "0 -4px 16px rgba(0,0,0,0.3)",
        zIndex: 20,
        display: "flex",
        flexDirection: "column",
        maxHeight: isMobile ? "45vh" : 320,
      }}
    >
      <div style={{ padding: 8, borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <input
          ref={filterRef}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter skills & commands..."
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: "4px 8px",
            background: "var(--bg-base)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            outline: "none",
            color: "var(--text-secondary)",
            fontFamily: "'JetBrains Mono',monospace",
            fontSize: isMobile ? 16 : 12,
            caretColor: "var(--green)",
          }}
        />
      </div>
      <div style={{ overflowY: "auto", minHeight: 0 }}>
        {groups.length === 0 && <div style={{ padding: "10px 12px", fontSize: isMobile ? 13 : 12, color: "var(--text-ghost)" }}>No matching skills or commands</div>}
        {groups.map((group) => (
          <div key={group.key}>
            <div style={{ padding: "6px 12px 2px", fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: "var(--text-ghost)" }}>{group.label}</div>
            {group.entries.map((entry) => (
              <div
                key={entry.name}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onPick(entry.name)}
                title={!isMobile ? entry.description : undefined}
                style={{
                  padding: isMobile ? "8px 12px" : "5px 12px",
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: isMobile ? "column" : "row",
                  alignItems: isMobile ? "stretch" : "center",
                  gap: isMobile ? 2 : 8,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--bg-subtle)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                }}
              >
                <span style={{ color: "var(--green)", fontFamily: "'JetBrains Mono',monospace", fontSize: 13, fontWeight: 600, flexShrink: 0 }}>/{entry.name}</span>
                {entry.description && (
                  <span
                    style={{
                      fontSize: isMobile ? 12 : 11,
                      color: "var(--text-ghost)",
                      ...(isMobile ? {} : { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }),
                    }}
                  >
                    {entry.description}
                  </span>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
