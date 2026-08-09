// Boot URL reconciliation, the half that must not go wrong quietly: what the
// pass refuses to disturb, and what it does when a step fails.
//
// The dangerous direction here is being too quiet - deciding an app is fine
// when it is not, which is permanent, because nothing is persisted and the unit
// itself is the only evidence the next boot has. The converging half lives in
// url-reconcile.test.ts.
//
// The fake world stands in for systemd: see url-reconcile-world.ts.

import { describe, it, expect } from "bun:test";
import { reconcileAppUrls } from "../url-reconcile.ts";
import { DOMAIN, oneApp, record, unitFor, world } from "./url-reconcile-world.ts";

describe("app-urls: what it refuses to disturb", () => {
  it("leaves a stopped app stopped, with the new file waiting", () => {
    const w = oneApp({ wrote: null, domain: DOMAIN, state: "stopped" });
    const report = reconcileAppUrls(w.deps);
    expect(w.calls).toEqual(["regenerate:hello"]);
    expect(w.units.get("hello")).toContain("BUREAU_APP_URL");
    expect(report.converged).toEqual(["hello"]);
    expect(report.restarted).toEqual([]);
  });

  it("leaves a failed app failed", () => {
    // An app that has come to rest in `failed` is where somebody has to look
    // at it. Starting it at boot would hide that and burn the start limit.
    const w = oneApp({ wrote: null, domain: DOMAIN, state: "failed" });
    reconcileAppUrls(w.deps);
    expect(w.calls).toEqual(["regenerate:hello"]);
  });

  it("restarts an app that was still starting up", () => {
    // `starting` is an activation somebody asked for: leaving it alone would
    // let it finish coming up on the address it is being moved off.
    const w = oneApp({ wrote: null, domain: DOMAIN, state: "starting" });
    reconcileAppUrls(w.deps);
    expect(w.calls).toEqual(["regenerate:hello", "restart:hello"]);
  });

  it("does not restart an app whose state it could not read", () => {
    // "systemd did not answer" is not "the app is running". The file still
    // converges; the app picks the address up whenever it next starts.
    const w = oneApp({ wrote: null, domain: DOMAIN });
    w.states.delete("hello"); // -> unknown
    reconcileAppUrls(w.deps);
    expect(w.calls).toEqual(["regenerate:hello"]);
  });

  it("converges without restarting anything when the state read itself fails", () => {
    const w = oneApp({ wrote: null, domain: DOMAIN });
    w.failStates = true;
    const report = reconcileAppUrls(w.deps);
    expect(w.calls).toEqual(["regenerate:hello"]);
    expect(report.restarted).toEqual([]);
  });

  it("skips an app with no unit file at all - and never creates or starts one", () => {
    // Registration installs units; the token pass ahead of this one repairs a
    // missing one. An app with no unit is one nobody asked this pass to bring
    // up, and starting it at boot would be a surprise.
    const w = oneApp({ wrote: null, domain: DOMAIN });
    w.units.delete("hello");
    const report = reconcileAppUrls(w.deps);
    expect(w.calls).toEqual([]);
    expect(report.noUnit).toEqual(["hello"]);
    expect(report.converged).toEqual([]);
  });
});

describe("app-urls: failure", () => {
  it("keeps going for the other apps when one cannot be rewritten", () => {
    const a = record({ name: "a", hostLabel: "a" });
    const b = record({ name: "b", hostLabel: "b" });
    const w = world({ apps: [a, b], domain: DOMAIN });
    w.units.set("a", unitFor(a, null));
    w.units.set("b", unitFor(b, null));
    w.states.set("a", "running");
    w.states.set("b", "running");
    w.failRegenerate.add("a");

    const report = reconcileAppUrls(w.deps);
    expect(report.failed).toEqual(["a"]);
    expect(report.converged).toEqual(["b"]);
    expect(w.calls).toEqual(["regenerate:a", "regenerate:b", "restart:b"]);
  });

  it("puts the previous unit back when the restart fails, so the drift stays visible", () => {
    // The one that cannot be papered over: nothing about this pass is
    // persisted, so an app whose unit was updated and whose restart failed
    // would look finished forever while its process holds the old
    // environment. Rolling the unit back is what keeps the next boot honest.
    const w = oneApp({ wrote: null, domain: DOMAIN });
    const before = w.units.get("hello")!;
    w.failRestart.add("hello");

    const report = reconcileAppUrls(w.deps);
    expect(w.calls).toEqual(["regenerate:hello", "restart:hello", "restore:hello"]);
    expect(w.units.get("hello")).toBe(before);
    expect(report.failed).toEqual(["hello"]);
    expect(report.converged).toEqual([]);
    expect(report.stuck).toEqual([]);
  });

  it("retries on the next boot after a failed restart", () => {
    // The point of the rollback, stated as the behaviour it buys.
    const w = oneApp({ wrote: null, domain: DOMAIN });
    w.failRestart.add("hello");
    reconcileAppUrls(w.deps);

    w.calls.length = 0;
    w.failRestart.clear();
    const second = reconcileAppUrls(w.deps);
    expect(w.calls).toEqual(["regenerate:hello", "restart:hello"]);
    expect(second.converged).toEqual(["hello"]);
    expect(w.units.get("hello")).toContain("BUREAU_APP_URL");
  });

  it("reports the app as stuck when the rollback fails too", () => {
    // Unit says one thing, running process another, and no later boot will
    // notice. It cannot be fixed here - only named, so it is not silent.
    const w = oneApp({ wrote: null, domain: DOMAIN });
    w.failRestart.add("hello");
    w.failRestore.add("hello");

    const report = reconcileAppUrls(w.deps);
    expect(report.stuck).toEqual(["hello"]);
    expect(report.failed).toEqual(["hello"]);
  });

  it("counts every app it looked at, including the ones it left alone", () => {
    const a = record({ name: "a", hostLabel: "a" });
    const b = record({ name: "b", hostLabel: "b" });
    const w = world({ apps: [a, b], domain: DOMAIN });
    w.units.set("a", unitFor(a, DOMAIN));
    const report = reconcileAppUrls(w.deps);
    expect(report.checked).toBe(2);
    expect(report.noUnit).toEqual(["b"]);
  });
});
