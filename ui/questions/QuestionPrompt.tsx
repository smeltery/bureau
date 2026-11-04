// A question's prompt as the member reads it: plain text, except that each
// ```diff fence is drawn as removed and added rows, so an agent can show the
// exact change it is asking about.

export type PromptPart = { kind: "text"; text: string } | { kind: "diff"; lines: string[] };

const FENCE = /^```diff[ \t]*\n([\s\S]*?)(?:\n```[ \t]*(?:\n|$)|$)/;

export function splitPrompt(prompt: string): PromptPart[] {
  const parts: PromptPart[] = [];
  let rest = prompt;
  let text = "";
  while (rest) {
    // A fence opens only at the start of a line.
    const at = rest.startsWith("```diff") ? 0 : rest.indexOf("\n```diff");
    if (at < 0) break;
    const start = at === 0 ? 0 : at + 1;
    const match = FENCE.exec(rest.slice(start));
    if (!match) break;
    text += rest.slice(0, start);
    if (text) parts.push({ kind: "text", text: text.replace(/\n$/, "") });
    text = "";
    parts.push({ kind: "diff", lines: match[1]!.split("\n") });
    rest = rest.slice(start + match[0].length);
  }
  text += rest;
  if (text) parts.push({ kind: "text", text });
  return parts;
}

function lineStyle(line: string) {
  if (line.startsWith("+") && !line.startsWith("+++")) return { background: "var(--green-bg)", color: "var(--green)" };
  if (line.startsWith("-") && !line.startsWith("---")) return { background: "var(--red-bg)", color: "var(--red)" };
  if (line.startsWith("@@")) return { color: "var(--text-ghost)" };
  return { color: "var(--text-dim)" };
}

export function QuestionPrompt({ prompt }: { prompt: string }) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      {splitPrompt(prompt).map((part, index) =>
        part.kind === "text" ? (
          <div key={index} style={{ whiteSpace: "pre-wrap" }}>
            {part.text}
          </div>
        ) : (
          <pre
            key={index}
            data-question-diff=""
            style={{ margin: 0, padding: "4px 0", overflowX: "auto", borderRadius: 6, border: "1px solid var(--border)", fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}
          >
            {part.lines.map((line, row) => (
              <div key={row} style={{ ...lineStyle(line), padding: "0 8px", whiteSpace: "pre" }}>
                {line || " "}
              </div>
            ))}
          </pre>
        ),
      )}
    </div>
  );
}
