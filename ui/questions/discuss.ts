// "Discuss in chat" starts a chat message about a question without
// answering it: a short quote of the question goes in front of the draft.

const EXCERPT_POINTS = 40;
// Back off to a word boundary only when that keeps a useful excerpt.
const MIN_WORD_CUT = 20;

export function questionExcerpt(prompt: string): string {
  const points = Array.from(prompt.replace(/\s+/g, " ").trim());
  if (points.length <= EXCERPT_POINTS) return points.join("");
  let head = points.slice(0, EXCERPT_POINTS);
  if (points[EXCERPT_POINTS] !== " ") {
    const space = head.lastIndexOf(" ");
    if (space > MIN_WORD_CUT) head = head.slice(0, space);
  }
  return `${head.join("").trimEnd()}…`;
}

// The draft with the prefix in front, added once however often it is tapped.
export function withDiscussPrefix(draft: string, prefix: string): string {
  return draft.startsWith(prefix) ? draft : prefix + draft;
}
