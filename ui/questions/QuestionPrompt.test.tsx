import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { QuestionPrompt, splitPrompt } from "./QuestionPrompt.tsx";

const prompt = "Apply this change?\n```diff\n@@ -1 +1 @@\n-timeout = 5\n+timeout = 30\n```\nIt only affects staging.";

test("diff fences split out of the surrounding text", () => {
  expect(splitPrompt(prompt)).toEqual([
    { kind: "text", text: "Apply this change?" },
    { kind: "diff", lines: ["@@ -1 +1 @@", "-timeout = 5", "+timeout = 30"] },
    { kind: "text", text: "It only affects staging." },
  ]);
});

test("plain prompts, other fences and mid-line markers stay text", () => {
  expect(splitPrompt("Pick one")).toEqual([{ kind: "text", text: "Pick one" }]);
  expect(splitPrompt("```ts\nconst a = 1;\n```")).toEqual([{ kind: "text", text: "```ts\nconst a = 1;\n```" }]);
  expect(splitPrompt("see ```diff inline")).toEqual([{ kind: "text", text: "see ```diff inline" }]);
});

test("an unclosed fence runs to the end, as in Markdown", () => {
  expect(splitPrompt("```diff\n-old\n+new")).toEqual([{ kind: "diff", lines: ["-old", "+new"] }]);
});

test("removed and added rows get the diff colors, and text stays escaped", () => {
  const html = renderToStaticMarkup(<QuestionPrompt prompt={`${prompt}\n<script>x</script>`} />);
  expect(html).toContain("var(--red-bg)");
  expect(html).toContain("var(--green-bg)");
  expect(html).not.toContain("<script>");
});
