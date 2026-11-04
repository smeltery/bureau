import { expect, test } from "bun:test";
import { singleChoiceAnswer } from "./QuestionCard.tsx";

test("a single-choice tap sends the label followed by any distinct typed note", () => {
  expect(singleChoiceAnswer("Done", "")).toBe("Done");
  expect(singleChoiceAnswer("Done", "  ")).toBe("Done");
  expect(singleChoiceAnswer("Done", "Done")).toBe("Done");
  expect(singleChoiceAnswer("Done", " Rotated the key too ")).toBe("Done\n\nRotated the key too");
});
