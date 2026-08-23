// Which verbs a row offers from a given state, and the order the rows come in.
// The UI has no React render harness, so the decision is extracted and covered
// here rather than through the rendered buttons.
//
// Pure: no DOM, no server.

import { describe, expect, test } from "bun:test";
import type { AppState as AppRunState, AppWire } from "../../shared/apps.ts";
import { APP_VERBS, STATE_COLOR, VERB_TITLES, sortApps, stateIsHollow, verbInert } from "./appVerbs.ts";

function enabledVerbs(state: AppRunState): string[] {
  return APP_VERBS.filter((verb) => !verbInert(verb, state));
}

function appWire(name: string, over: Partial<AppWire> = {}): AppWire {
  return {
    name,
    hostLabel: name,
    hostGen: 1,
    port: 21000,
    command: "bun run serve.ts",
    cwd: "/home/alice/app",
    dataDir: `/home/alice/.bureau/apps/${name}`,
    userId: "u-alice",
    username: "alice",
    createdBy: "Agent1",
    createdAt: 1,
    state: "running",
    restartCount: 0,
    canManage: true,
    ...over,
  };
}

describe("verbInert", () => {
  test("a running app cannot be started again", () => {
    // The catch this exists for: a running app rendered a clickable `start`,
    // which reads as a bug even though the supervisor would no-op it.
    expect(enabledVerbs("running")).toEqual(["stop", "restart"]);
  });

  test("a starting app is treated as up", () => {
    expect(enabledVerbs("starting")).toEqual(["stop", "restart"]);
  });

  test("a stopped app offers start alone", () => {
    // Restart is not a way to bring a stopped app up in this UI: `start` is.
    expect(enabledVerbs("stopped")).toEqual(["start"]);
  });

  test("a failed app keeps restart — it is the recovery verb", () => {
    expect(enabledVerbs("failed")).toEqual(["start", "restart"]);
  });

  test("unknown leaves every verb enabled", () => {
    // `unknown` means nobody could be asked, so the UI must not decide for the
    // human what cannot possibly work.
    expect(enabledVerbs("unknown")).toEqual(["start", "stop", "restart"]);
  });
});

describe("state presentation", () => {
  test("every state has a colour and only unknown draws hollow", () => {
    const states: AppRunState[] = ["running", "starting", "stopped", "failed", "unknown"];
    for (const state of states) expect(STATE_COLOR[state]).toBeTruthy();
    expect(states.filter(stateIsHollow)).toEqual(["unknown"]);
  });

  test("every verb has a plain-language tooltip", () => {
    // The buttons are single opaque words; the title is what explains them.
    for (const verb of APP_VERBS) expect(VERB_TITLES[verb].length).toBeGreaterThan(0);
  });
});

describe("sortApps", () => {
  test("orders by name and leaves the input alone", () => {
    const apps = [appWire("gamma"), appWire("alpha"), appWire("beta")];
    expect(sortApps(apps).map((a) => a.name)).toEqual(["alpha", "beta", "gamma"]);
    expect(apps.map((a) => a.name)).toEqual(["gamma", "alpha", "beta"]);
  });
});
