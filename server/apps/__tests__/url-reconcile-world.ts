// The fake world the boot URL reconciliation tests run against: unit text per
// app, a state per app, and a call log. No subprocesses, no files, no systemd.
//
// Its own module because the pass is tested from two angles - what it converges
// (url-reconcile.test.ts) and what it refuses to disturb or cannot repair
// (url-reconcile-failure.test.ts) - and both need the same world. Nothing
// outside those two files imports it.

import { appHostEnvDirective, appHostForUrl, appUrlEnvDirective } from "../supervisor.ts";
import { appPublicUrl } from "../domain.ts";
import type { AppUrlReconcileDeps } from "../url-reconcile.ts";
import type { AppRecord, AppState } from "../../../shared/apps.ts";

export const DOMAIN = "office.example";
// A tailnet office's own name, the one the regression happened on.
export const TAILNET_HOST = "auntie.parrot-fish.ts.net";
export const TAILNET_ORIGIN = `https://${TAILNET_HOST}`;

export const record = (over: Partial<AppRecord> = {}): AppRecord => ({
  name: "hello",
  hostLabel: "hello",
  hostGen: 1,
  port: 21000,
  command: "bun run serve.ts",
  cwd: "/srv/hello",
  dataDir: "/state/apps/data/hello",
  userId: "u1",
  username: "Alice",
  createdBy: "AppBot",
  createdAt: 1,
  ...over,
});

// A unit as the supervisor would have written it under `domain` - the only
// part of one this pass looks at, built through the production directive
// builder so the fixture cannot drift from what the renderer emits.
export const unitFor = (app: AppRecord, domain: string | null): string => {
  const url = appPublicUrl(app.hostLabel, domain);
  const lines = ["[Service]", `Environment="PORT=${app.port}"`];
  if (url !== null) {
    lines.push(appUrlEnvDirective(url));
    const host = appHostForUrl(url);
    if (host !== null) lines.push(appHostEnvDirective(host));
  }
  return `${lines.join("\n")}\n`;
};

export interface World {
  apps: AppRecord[];
  // The office's domain NOW. The units start out written under whatever the
  // test says they were written under, which is how drift is constructed.
  domain: string | null;
  units: Map<string, string>;
  states: Map<string, AppState>;
  calls: string[];
  failRegenerate: Set<string>;
  failRestart: Set<string>;
  failRestore: Set<string>;
  failStates: boolean;
  deps: AppUrlReconcileDeps;
}

export function world(over: Partial<Omit<World, "deps">> = {}): World {
  const w: World = {
    apps: [record()],
    domain: DOMAIN,
    units: new Map(),
    states: new Map(),
    calls: [],
    failRegenerate: new Set(),
    failRestart: new Set(),
    failRestore: new Set(),
    failStates: false,
    deps: null as unknown as AppUrlReconcileDeps,
    ...over,
  };
  w.deps = {
    list: () => w.apps,
    expectedUrl: (app) => appPublicUrl(app.hostLabel, w.domain),
    // Reads are not logged: the pass reads every app's unit on every boot, and
    // a test asserting "nothing happened" means no WRITES and no restarts.
    readUnitFile: (name) => w.units.get(name) ?? null,
    restoreUnitFile: (name, contents) => {
      w.calls.push(`restore:${name}`);
      if (w.failRestore.has(name)) throw new Error("read-only filesystem");
      w.units.set(name, contents);
    },
    regenerate: (app) => {
      w.calls.push(`regenerate:${app.name}`);
      if (w.failRegenerate.has(app.name)) throw new Error("cannot write unit");
      w.units.set(app.name, unitFor(app, w.domain));
    },
    states: (names) => {
      if (w.failStates) throw new Error("systemctl is not answering");
      return new Map(names.map((n) => [n, { state: w.states.get(n) ?? "unknown", restartCount: 0 }]));
    },
    restart: (name) => {
      w.calls.push(`restart:${name}`);
      if (w.failRestart.has(name)) throw new Error("unit failed to start");
    },
  };
  return w;
}

// The common setup: one running app whose unit was written under `wrote` while
// the office now says `domain`.
export const oneApp = (opts: { wrote: string | null; domain: string | null; state?: AppState; app?: AppRecord }): World => {
  const app = opts.app ?? record();
  const w = world({ apps: [app], domain: opts.domain });
  w.units.set(app.name, unitFor(app, opts.wrote));
  w.states.set(app.name, opts.state ?? "running");
  return w;
};
