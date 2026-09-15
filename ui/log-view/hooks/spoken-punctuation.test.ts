// The recognizer hands back speech one fragment at a time, so the two halves
// are tested together: the substitution inside a fragment, and the joining of
// fragments into composer text.
import { describe, expect, it } from "bun:test";
import {
  addFinalized,
  advanceDictationSession,
  applySpokenPunctuation,
  dictationText,
  isSpokenSubmit,
  joinSpoken,
  reconcileDictationEdit,
  startDictation,
  startDictationSession,
  type Dictation,
} from "./spoken-punctuation.ts";

describe("applySpokenPunctuation", () => {
  it("converts sentence punctuation and hugs the preceding word", () => {
    expect(applySpokenPunctuation("is this on question mark")).toBe("is this on?");
    expect(applySpokenPunctuation("ship it period")).toBe("ship it.");
    expect(applySpokenPunctuation("ship it full stop")).toBe("ship it.");
    expect(applySpokenPunctuation("wait comma then go")).toBe("wait, then go");
    expect(applySpokenPunctuation("no exclamation mark")).toBe("no!");
    expect(applySpokenPunctuation("no exclamation point")).toBe("no!");
    expect(applySpokenPunctuation("note colon read this")).toBe("note: read this");
    expect(applySpokenPunctuation("one semicolon two")).toBe("one; two");
    expect(applySpokenPunctuation("one semi colon two")).toBe("one; two");
    expect(applySpokenPunctuation("hmm ellipsis maybe")).toBe("hmm... maybe");
  });

  it("hugs parentheses to the side they belong to", () => {
    expect(applySpokenPunctuation("run it open paren twice close paren today")).toBe("run it (twice) today");
    expect(applySpokenPunctuation("run it open parenthesis twice close parenthesis today")).toBe("run it (twice) today");
  });

  it("converts newline commands that end the fragment", () => {
    expect(applySpokenPunctuation("first line new line")).toBe("first line\n");
    expect(applySpokenPunctuation("first line newline")).toBe("first line\n");
    expect(applySpokenPunctuation("end of section new paragraph")).toBe("end of section\n\n");
  });

  it("leaves sentence-terminal words alone mid-fragment: they are ordinary English", () => {
    // "a period of time" is the case that makes the terminal gate necessary.
    expect(applySpokenPunctuation("a period of time passed")).toBe("a period of time passed");
    expect(applySpokenPunctuation("draw a new line on the chart")).toBe("draw a new line on the chart");
    expect(applySpokenPunctuation("come to a full stop at the sign")).toBe("come to a full stop at the sign");
  });

  it("does not match a command that is only a prefix of a longer word", () => {
    expect(applySpokenPunctuation("periodic review")).toBe("periodic review");
    expect(applySpokenPunctuation("two new lines")).toBe("two new lines");
  });

  it("is case-insensitive and tolerates the recognizer's own spacing", () => {
    expect(applySpokenPunctuation("really Question Mark")).toBe("really?");
    expect(applySpokenPunctuation("really question  mark")).toBe("really?");
  });
});

describe("joinSpoken", () => {
  it("inserts one separating space, and only when neither side has one", () => {
    expect(joinSpoken("hello", "world")).toBe("hello world");
    expect(joinSpoken("hello ", "world")).toBe("hello world");
    expect(joinSpoken("hello", " world")).toBe("hello world");
  });

  it("lets punctuation hug the text it belongs to", () => {
    expect(joinSpoken("hello", ", again")).toBe("hello, again");
    expect(joinSpoken("hello ", "?")).toBe("hello?");
    expect(joinSpoken("(", "inside")).toBe("(inside");
    expect(joinSpoken("line\n", "next")).toBe("line\nnext");
  });

  it("passes an empty side straight through", () => {
    expect(joinSpoken("", "only")).toBe("only");
    expect(joinSpoken("only", "")).toBe("only");
  });
});

describe("dictation sessions", () => {
  function session(base: string, locale = "en-US", ...finalized: string[]): Dictation {
    return finalized.reduce(addFinalized, startDictation(base, locale));
  }

  it("appends dictation to what the composer already held, untouched", () => {
    // Typed text is never substituted — only what was spoken.
    const d = session("a period of time", "en-US", "then this period");
    expect(dictationText(d, "")).toBe("a period of time then this.");
  });

  it("recognizes a mark the recognizer split across fragments", () => {
    // The unconditional pass runs over the joined stream, so "question" then
    // "mark" still becomes "?".
    const d = session("", "en-US", "is it", "question", "mark");
    expect(dictationText(d, "")).toBe("is it?");
  });

  it("re-decides a terminal command as the interim guess grows", () => {
    const d = session("", "en-US", "stop here");
    // Fragment-final while the guess ends there…
    expect(dictationText(d, "period")).toBe("stop here.");
    // …and ordinary English once it does not.
    expect(dictationText(d, "period of calm")).toBe("stop here period of calm");
  });

  it("keeps each finalized fragment's own terminal decision", () => {
    const d = session("", "en-US", "first period", "a period of time");
    expect(dictationText(d, "")).toBe("first. a period of time");
  });

  it("rebases deletions made while dictation is still listening", () => {
    let d = startDictationSession("todo", "en-US");
    d = advanceDictationSession(d, ["add tests"], "period");
    expect(d.display).toBe("todo add tests.");

    d = reconcileDictationEdit(d, "todo");
    d = advanceDictationSession(d, [], "then run them");

    expect(d.display).toBe("todo then run them");
  });

  it("keeps edits inside finalized text instead of resurrecting old text", () => {
    let d = startDictationSession("ship", "en-US");
    d = advanceDictationSession(d, ["today"], "period");
    expect(d.display).toBe("ship today.");

    d = reconcileDictationEdit(d, "ship tomorrow.");
    d = advanceDictationSession(d, [], "please");

    expect(d.display).toBe("ship tomorrow please");
  });

  it("preserves pure appends beyond the stable prefix", () => {
    let d = startDictationSession("", "en-US");
    d = advanceDictationSession(d, ["hello"], "world");
    expect(d.display).toBe("hello world");

    d = reconcileDictationEdit(d, "hello world!");
    d = advanceDictationSession(d, [], "again");

    expect(d.display).toBe("hello! again");
  });

  it("preserves locale gating after a mid-dictation edit", () => {
    let d = startDictationSession("", "es-ES");
    d = advanceDictationSession(d, ["espera coma"], "");
    d = reconcileDictationEdit(d, "espera coma ahora");
    d = advanceDictationSession(d, ["period"], "");

    expect(d.display).toBe("espera coma ahora period");
  });
});

describe("locale command data", () => {
  it("uses the recognizer locale primary subtag without an English fallback", () => {
    expect(applySpokenPunctuation("hola coma", "es-419")).toBe("hola,");
    expect(applySpokenPunctuation("hello comma world", "en-GB")).toBe("hello, world");
    expect(applySpokenPunctuation("bonjour comma monde", "fr-FR")).toBe("bonjour comma monde");
  });

  it("gates collision-prone Spanish comma on the fragment end", () => {
    expect(applySpokenPunctuation("quiero que coma algo", "es-ES")).toBe("quiero que coma algo");
    expect(applySpokenPunctuation("hola coma", "es-ES")).toBe("hola,");
  });

  it("matches accented phrases at Unicode word edges", () => {
    expect(applySpokenPunctuation("signo de interrogación hola", "es-ES")).toBe("? hola");
    expect(applySpokenPunctuation("hola signo de interrogación", "es-ES")).toBe("hola?");
    expect(applySpokenPunctuation("obre parèntesi text", "ca-ES")).toBe("(text");
    expect(applySpokenPunctuation("text tanca parèntesi", "ca-ES")).toBe("text)");
  });

  it("converts unspaced Chinese commands and hugs fullwidth marks", () => {
    expect(applySpokenPunctuation("你好逗号世界", "zh-CN")).toBe("你好，世界");
    expect(applySpokenPunctuation("左括号内容右括号", "zh-CN")).toBe("（内容）");
    expect(joinSpoken("你好", "，世界")).toBe("你好，世界");
    expect(joinSpoken("（", "内容")).toBe("（内容");
  });

  it("recognizes submit only as a whole fragment in the selected locale", () => {
    expect(isSpokenSubmit("  SUBMIT  ", "en-US")).toBe(true);
    expect(isSpokenSubmit("submit the form", "en-US")).toBe(false);
    expect(isSpokenSubmit("Submit.", "en-US")).toBe(false);
    expect(isSpokenSubmit("enviar", "es-ES")).toBe(true);
    expect(isSpokenSubmit("enviar", "ca-ES")).toBe(true);
    expect(isSpokenSubmit("提交", "zh-CN")).toBe(true);
    expect(isSpokenSubmit("submit", "fr-FR")).toBe(false);
  });
});
