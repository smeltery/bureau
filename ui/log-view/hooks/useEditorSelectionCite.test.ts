import { describe, expect, test } from "bun:test";
import { citationBlock } from "./useCiteInsertion.ts";
import { editorCiteTitle } from "./useEditorSelectionCite.ts";

describe("editorCiteTitle", () => {
  test("names the file with home shortened and the selected line range", () => {
    expect(editorCiteTitle("/home/ada/dev/app/main.ts", 12, 18)).toBe("~/dev/app/main.ts:12-18");
    expect(citationBlock("const x = 1;", editorCiteTitle("/home/ada/dev/app/main.ts", 4, 4))).toBe('~/dev/app/main.ts:4:\n"""\nconst x = 1;\n"""\n');
  });

  test("keeps paths outside home as they are", () => {
    expect(editorCiteTitle("/srv/app/config.json", 1, 3)).toBe("/srv/app/config.json:1-3");
  });
});
