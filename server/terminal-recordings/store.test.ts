import * as fs from "node:fs";
import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeAllRecordings, isRecordingActive, recordingEnabled, saveRecordingEnabled, startRecording } from "./store.ts";
import { deleteRecording, listRecordingIds, readRecording, recordingDirectory, recordingPath } from "./files.ts";
import { createRecordingRedactor } from "./redaction.ts";
const roots: string[] = [];
function root() {
  const dir = mkdtempSync(join(tmpdir(), "bureau-recording-"));
  roots.push(dir);
  return dir;
}
afterEach(() => {
  closeAllRecordings();
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("recording defaults off without creating files and refuses malformed settings", () => {
  const dir = root();
  expect(recordingEnabled(dir)).toBe(false);
  expect(startRecording("a", "room", () => {}, dir)).toBeNull();
  expect(readdirSync(dir)).toEqual([]);
  writeFileSync(join(dir, "terminal-recording-settings.json"), "broken");
  const statuses: string[] = [];
  expect(startRecording("a", "room", (status) => statuses.push(status), dir)).toBeNull();
  expect(statuses).toEqual(["error"]);
  expect(readFileSync(join(dir, "terminal-recording-settings.json"), "utf8")).toBe("broken");
});

test("recordings preserve redacted output, dimensions and input attribution without per-keystroke timing", () => {
  const dir = root();
  saveRecordingEnabled(true, dir);
  let clock = 1000;
  const statuses: string[] = [];
  const recording = startRecording(
    "a",
    "room",
    (status) => statuses.push(status),
    dir,
    () => clock,
  )!;
  expect(isRecordingActive(recording.id)).toBe(true);
  recording.output("hello\r\n");
  recording.output("sk-proj-" + "A".repeat(12));
  recording.output("A".repeat(18) + "\r\n");
  recording.input("member:one");
  clock += 4000;
  recording.input("member:one");
  recording.output("prompt\r\n");
  clock += 4000;
  recording.input("member:one");
  recording.input("member:two");
  recording.resize(120, 40);
  recording.close("terminal closed", "terminalClosed");
  recording.close("again");
  recording.output("after close");
  const result = readRecording(recording.id, false, dir);
  expect(result.events.filter((event) => event.type === "typist")).toHaveLength(3);
  expect(result.events.filter((event) => event.type === "end")).toHaveLength(1);
  expect(result.events.at(-1)).toMatchObject({ reason: "terminal closed", reasonCode: "terminalClosed" });
  expect(result.events).toContainEqual({ type: "resize", at: 8000, cols: 120, rows: 40 });
  const serialized = JSON.stringify(result);
  expect(serialized).toContain("REDACTED");
  expect(serialized).not.toContain("A".repeat(20));
  expect(serialized).not.toContain("after close");
  expect(statuses).toEqual(["recording", "stopped"]);
  expect(listRecordingIds(dir)).toEqual([recording.id]);
  expect(isRecordingActive(recording.id)).toBe(false);
  deleteRecording(recording.id, dir);
  expect(listRecordingIds(dir)).toEqual([]);
});

test("redactor handles every split boundary and omits oversized lines through their newline", () => {
  const secret = "github_pat_" + "Z".repeat(82);
  for (let split = 0; split < secret.length; split++) {
    let text = "";
    const redactor = createRecordingRedactor((value) => {
      text += value;
    });
    redactor.push(secret.slice(0, split));
    redactor.push(secret.slice(split));
    expect(text).toBe("");
    redactor.finish();
    expect(text).not.toContain("Z".repeat(20));
    expect(text).toContain("REDACTED");
  }
  let text = "";
  const redactor = createRecordingRedactor((value) => {
    text += value;
  });
  redactor.push("x".repeat(65537));
  redactor.push("secret tail\nnext\n");
  redactor.finish();
  expect(text).toBe("[Long output line omitted]\r\nnext\n");
});

test("disabling stops active recordings and flushes the final partial line", () => {
  const dir = root();
  saveRecordingEnabled(true, dir);
  const recording = startRecording("a", "r", () => {}, dir)!;
  recording.output("final prompt");
  saveRecordingEnabled(false, dir);
  expect(isRecordingActive(recording.id)).toBe(false);
  expect(JSON.stringify(readRecording(recording.id, false, dir))).toContain("final prompt");
  expect(readRecording(recording.id, false, dir).events.at(-1)).toMatchObject({ type: "end", reason: "disabled", reasonCode: "disabled" });
});

test("file access rejects traversal and symlinks, and crash fragments stay readable", () => {
  const dir = root();
  saveRecordingEnabled(true, dir);
  const recording = startRecording("a", "r", () => {}, dir)!;
  recording.close("closed");
  const path = recordingPath(recording.id, dir);
  const text = readFileSync(path, "utf8");
  writeFileSync(path, text + '{"unfinished":');
  expect(readRecording(recording.id, false, dir).header.agentId).toBe("a");
  expect(() => readRecording("../settings", false, dir)).toThrow();
  rmSync(path);
  symlinkSync(join(dir, "terminal-recording-settings.json"), path);
  expect(() => readRecording(recording.id, false, dir)).toThrow();
  expect(() => deleteRecording(recording.id, dir)).toThrow();
  const other = root();
  symlinkSync(recordingDirectory(dir), recordingDirectory(other));
  saveRecordingEnabled(true, other);
  expect(startRecording("a", "r", () => {}, other)).toBeNull();
});

test("size cap stops the recording while retaining a readable end marker", () => {
  const dir = root();
  saveRecordingEnabled(true, dir);
  const recording = startRecording("a", "r", () => {}, dir)!;
  for (let i = 0; i < 400; i++) recording.output("x".repeat(60000) + "\n");
  expect(isRecordingActive(recording.id)).toBe(false);
  expect(readRecording(recording.id, false, dir).events.at(-1)).toMatchObject({ type: "end", reason: "size limit reached", reasonCode: "sizeLimit" });
});

test("disk failures stop recording without throwing into terminal output", () => {
  const dir = root();
  saveRecordingEnabled(true, dir);
  const statuses: string[] = [];
  const recording = startRecording("a", "r", (status) => statuses.push(status), dir)!;
  const write = spyOn(fs, "writeSync").mockImplementation(() => {
    throw new Error("disk full");
  });
  try {
    expect(() => {
      recording.output("displayed output\n");
      recording.close("closed");
    }).not.toThrow();
    expect(isRecordingActive(recording.id)).toBe(false);
    expect(statuses).toEqual(["recording", "error"]);
  } finally {
    write.mockRestore();
  }
});

test("unknown input attribution is distinct from a literal matching member name", () => {
  const dir = root();
  saveRecordingEnabled(true, dir);
  const recording = startRecording(
    "a",
    "r",
    () => {},
    dir,
    () => 1000,
  )!;
  recording.input("unknown member", true);
  recording.input("unknown member", true);
  recording.input("unknown member");
  recording.close("Original legacy reason");
  const events = readRecording(recording.id, false, dir).events;
  expect(events.filter((event) => event.type === "typist")).toEqual([
    { type: "typist", at: 0, actor: "unknown member", unknownActor: true },
    { type: "typist", at: 0, actor: "unknown member" },
  ]);
  expect(events.at(-1)).toEqual({ type: "end", at: 0, reason: "Original legacy reason" });
});
