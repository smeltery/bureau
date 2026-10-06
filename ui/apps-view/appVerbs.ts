// The Apps tab's decisions about a row: which verbs it offers, whether each one
// can do anything from where the app currently is, what colour the state reads
// in, and the order the rows come in. Pure, and extracted from the view so they
// can be covered without a React render harness.

import type { AppListWire, AppState as AppRunState } from "../../shared/apps.ts";
import type { AppFilter } from "../device-settings.ts";

export const APP_VERBS = ["start", "stop", "restart"] as const;
export type AppVerb = (typeof APP_VERBS)[number] | "archive" | "restore";

// Plain language, not the verb again: the buttons are opaque to a
// non-technical user.
export const VERB_TITLES: Record<AppVerb, string> = {
  archive: "Archive the app and keep its data",
  restore: "Restore and run the archived app",
  start: "Run the app",
  stop: "Shut the app down (its data is kept)",
  restart: "Stop the app and start it again",
};

/**
 * A verb that cannot change the app's current state renders disabled: "start"
 * on a running app reads as a bug even though the supervisor would no-op it.
 * State can be up to one poll stale, so this is an affordance, not a guard —
 * "unknown" leaves every verb enabled. "restart" stays enabled on a failed app
 * because it is the recovery verb.
 */
export function verbInert(verb: AppVerb, state: AppRunState): boolean {
  switch (state) {
    case "running":
    case "starting":
      return verb === "start";
    case "stopped":
      return verb !== "start";
    case "failed":
      return verb === "stop";
    case "unknown":
      return false;
  }
}

export const STATE_COLOR: Record<AppRunState, string> = {
  running: "var(--green)",
  starting: "var(--orange, #d29922)",
  stopped: "var(--text-muted)",
  failed: "var(--red)",
  unknown: "var(--text-muted)",
};

// `unknown` draws hollow: it is not a synonym for `stopped`, and a filled grey
// dot would read as one.
export function stateIsHollow(state: AppRunState): boolean {
  return state === "unknown";
}

/** By name, which is the app's identity and the only stable order a list has. */
export function sortApps(apps: readonly AppListWire[]): AppListWire[] {
  return [...apps].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * "Stopped" means that one state: failed and unknown apps still need human
 * attention. "Mine" is based on app owner, not the agent that registered it.
 */
export function filterApps<T extends Pick<AppListWire, "state"> & { userId?: string | null }>(apps: readonly T[], filters: Record<AppFilter, boolean>, selfUserId: string | null): T[] {
  return apps.filter((app) => !(filters.hideStopped && app.state === "stopped") && !(filters.onlyMine && selfUserId !== null && app.userId !== selfUserId));
}
