export function InputAutocomplete({
  filteredCommands,
  skillOrigins,
  commandDescriptions,
  selectedIdx,
  setSelectedIdx,
  completeCommand,
  textareaRef,
}: {
  filteredCommands: string[];
  skillOrigins: Map<string, string>;
  commandDescriptions: Map<string, string>;
  selectedIdx: number;
  setSelectedIdx: (v: number | ((prev: number) => number)) => void;
  completeCommand: (name: string) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  return (
    <div
      style={{
        position: "absolute",
        bottom: "100%",
        left: 0,
        right: 0,
        marginBottom: 4,
        background: "var(--bg-surface)",
        border: "1px solid var(--border-medium)",
        borderRadius: 8,
        maxHeight: 200,
        overflowY: "auto",
        boxShadow: "0 -4px 16px rgba(0,0,0,0.3)",
        zIndex: 10,
      }}
    >
      {filteredCommands.map((cmd, i) => {
        const originLabel = skillOrigins.get(cmd);
        const desc = commandDescriptions.get(cmd);
        return (
          <div
            key={cmd}
            ref={i === selectedIdx ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}
            onMouseDown={(e) => {
              e.preventDefault();
              completeCommand(cmd);
              textareaRef.current?.focus();
            }}
            onMouseEnter={() => setSelectedIdx(i)}
            style={{
              padding: "6px 12px",
              cursor: "pointer",
              background: i === selectedIdx ? "var(--bg-subtle)" : "transparent",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span
              style={{
                color: "var(--green)",
                fontFamily: "'JetBrains Mono',monospace",
                fontSize: 13,
                fontWeight: 600,
                flexShrink: 0,
              }}
            >
              /{cmd}
            </span>
            {originLabel && (
              <span
                style={{
                  fontSize: 10,
                  color: "var(--text-ghost)",
                  background: "var(--bg-base)",
                  padding: "1px 6px",
                  borderRadius: 4,
                  flexShrink: 0,
                }}
              >
                {originLabel}
              </span>
            )}
            {desc && (
              <span
                style={{
                  fontSize: 11,
                  color: "var(--text-ghost)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {desc}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
