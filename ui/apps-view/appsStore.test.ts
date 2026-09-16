// The apps slice of the store: the poll snapshot (apps_loaded) against the
// server's deltas (app_updated / app_removed).
//
// full_state does NOT carry apps, and a rehydrate must not silently empty the
// list — the tab re-fetches on hydrationEpoch instead.
//
// Pure: no DOM, no server.

import { describe, expect, test } from "bun:test";
import type { AppWire } from "../../shared/apps.ts";
import { initialState } from "../store-initial-state.ts";
import { reducer } from "../store-reducer.ts";

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

const seeded = reducer(initialState, { type: "apps_loaded", apps: [appWire("alpha"), appWire("beta")], revision: 0 });

describe("reducer: apps", () => {
  test("apps_loaded REPLACES the slice, so a vanished app does not linger", () => {
    // This is the poll result. A merge would keep showing an app somebody
    // deleted from another tab if its delta was missed.
    const next = reducer(seeded, { type: "apps_loaded", apps: [appWire("beta", { state: "stopped" })], revision: seeded.appsRevision });
    expect(next.apps.map((a) => a.name)).toEqual(["beta"]);
    expect(next.apps[0]!.state).toBe("stopped");
    expect(next.appsLoaded).toBe(true);
  });

  test("app_updated REPLACES a known app in place, keyed by name", () => {
    const next = reducer(seeded, { type: "app_updated", app: appWire("alpha", { state: "failed", restartCount: 3 }) });
    expect(next.apps.map((a) => a.name)).toEqual(["alpha", "beta"]);
    expect(next.apps[0]!.state).toBe("failed");
    expect(next.apps[0]!.restartCount).toBe(3);
  });

  test("app_updated APPENDS an app we have never seen", () => {
    const next = reducer(seeded, { type: "app_updated", app: appWire("gamma") });
    expect(next.apps.map((a) => a.name)).toEqual(["alpha", "beta", "gamma"]);
  });

  test("app_updated is idempotent — the same delta twice holds one row", () => {
    const app = appWire("alpha", { state: "stopped" });
    const once = reducer(seeded, { type: "app_updated", app });
    const twice = reducer(once, { type: "app_updated", app });
    expect(twice.apps.map((a) => a.name)).toEqual(["alpha", "beta"]);
  });

  test("app_removed drops the app, and a repeat leaves the rows alone", () => {
    const gone = reducer(seeded, { type: "app_removed", name: "alpha" });
    expect(gone.apps.map((a) => a.name)).toEqual(["beta"]);
    // A delta racing the tab's first fetch must not throw or clear the list.
    // The rows are untouched, but the revision still moves — see the
    // do-not-hold case below for why that is not an accident.
    const again = reducer(gone, { type: "app_removed", name: "alpha" });
    expect(again.apps).toBe(gone.apps);
    expect(again.appsRevision).toBe(gone.appsRevision + 1);
  });

  // THE RACE: a list GET is a snapshot of the moment it was issued. If a delta
  // lands while it is in flight, the snapshot is older than what we hold, and
  // applying it would undo the delta — resurrecting a deleted app or reverting a
  // stopped one until the next poll.
  test("refuses a list response that a delta overtook while it was in flight", () => {
    const revisionAtRequest = seeded.appsRevision;
    const afterDelta = reducer(seeded, { type: "app_removed", name: "alpha" });
    expect(afterDelta.apps.map((a) => a.name)).toEqual(["beta"]);
    // The older snapshot — which still lists alpha — now arrives.
    const afterStale = reducer(afterDelta, { type: "apps_loaded", apps: [appWire("alpha"), appWire("beta")], revision: revisionAtRequest });
    expect(afterStale.apps.map((a) => a.name)).toEqual(["beta"]);
    // Still counts as loaded: the fetch succeeded, and pinning the tab to its
    // loading state over a won race would be its own bug.
    expect(afterStale.appsLoaded).toBe(true);
  });

  test("refuses a stale snapshot that would revert an update", () => {
    const revisionAtRequest = seeded.appsRevision;
    const afterDelta = reducer(seeded, { type: "app_updated", app: appWire("alpha", { state: "stopped" }) });
    const afterStale = reducer(afterDelta, { type: "apps_loaded", apps: [appWire("alpha", { state: "running" }), appWire("beta")], revision: revisionAtRequest });
    expect(afterStale.apps.find((a) => a.name === "alpha")!.state).toBe("stopped");
  });

  test("a removal for an app we do not hold still moves the revision", () => {
    // Otherwise an in-flight GET that DOES carry that app would be accepted and
    // resurrect it: the row is missing here, not everywhere.
    const after = reducer(seeded, { type: "app_removed", name: "ghost" });
    expect(after.appsRevision).toBe(seeded.appsRevision + 1);
    expect(after.apps.map((a) => a.name)).toEqual(["alpha", "beta"]);
  });

  test("accepts the snapshot once its revision is current again", () => {
    const afterDelta = reducer(seeded, { type: "app_removed", name: "alpha" });
    const fresh = reducer(afterDelta, { type: "apps_loaded", apps: [appWire("beta"), appWire("gamma")], revision: afterDelta.appsRevision });
    expect(fresh.apps.map((a) => a.name)).toEqual(["beta", "gamma"]);
  });

  test("a rehydrate leaves the apps slice alone", () => {
    // full_state carries no apps: clearing here would blank the tab on every
    // reconnect, and the poll (keyed on hydrationEpoch) is what refreshes it.
    const hydrated = reducer(seeded, {
      type: "full_state",
      agents: [],
      recentCwds: [],
      office: { prompt: null, envFile: null, previewAllowHosts: [], experimental: { browserPanel: false }, receptionistAgentId: null },
      rooms: [],
      killedAgents: [],
    });
    expect(hydrated.apps.map((a) => a.name)).toEqual(["alpha", "beta"]);
    expect(hydrated.appsLoaded).toBe(true);
  });
});
