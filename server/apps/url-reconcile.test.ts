// Boot URL reconciliation, the converging half: does every app's unit end up
// declaring the address the office would give it today, and does a boot where
// nothing changed cost nothing?
//
// The dangerous direction here is being too eager - restarting apps that were
// at rest, or rewriting units that were already right, which would bounce every
// app on every boot. The opposite direction (deciding an app is fine when it is
// not, which is permanent because nothing is persisted) lives in
// url-reconcile-failure.test.ts.
//
// The fake world stands in for systemd: see url-reconcile-world.ts.

import { describe, it, expect } from "bun:test";
import { reconcileAppUrls } from "./url-reconcile.ts";
import { deriveAppHostDomain } from "./domain.ts";
import { DOMAIN, TAILNET_HOST, TAILNET_ORIGIN, oneApp, record, unitFor, world } from "./url-reconcile-world.ts";

describe("app-urls: convergence", () => {
  it("gives a running app its new address and restarts it once", () => {
    // The transition this pass exists for: an operator points a domain at the
    // office, and the apps that were already serving learn where they live.
    const w = oneApp({ wrote: null, domain: DOMAIN });
    const report = reconcileAppUrls(w.deps);

    expect(w.calls).toEqual(["regenerate:hello", "restart:hello"]);
    expect(w.units.get("hello")).toContain('Environment="BUREAU_APP_URL=https://hello.office.example"');
    expect(report.converged).toEqual(["hello"]);
    expect(report.restarted).toEqual(["hello"]);
    expect(report.failed).toEqual([]);
  });

  it("takes the address away again when the office stops being reachable", () => {
    // The reverse: an office that went back to plain HTTP. The variable must
    // be GONE, not emptied, or every app keeps advertising a dead address.
    const w = oneApp({ wrote: DOMAIN, domain: null });
    reconcileAppUrls(w.deps);

    expect(w.calls).toEqual(["regenerate:hello", "restart:hello"]);
    expect(w.units.get("hello")).not.toContain("BUREAU_APP_URL");
  });

  it("follows the domain when it changes", () => {
    const w = oneApp({ wrote: "old.example", domain: "new.example" });
    reconcileAppUrls(w.deps);
    expect(w.units.get("hello")).toContain('Environment="BUREAU_APP_URL=https://hello.new.example"');
  });

  it("uses the app's LABEL, not its reusable name", () => {
    const app = record({ hostLabel: "hello-g2", hostGen: 2 });
    const w = oneApp({ wrote: null, domain: DOMAIN, app });
    reconcileAppUrls(w.deps);
    expect(w.units.get("hello")).toContain('Environment="BUREAU_APP_URL=https://hello-g2.office.example"');
  });

  it("does NOTHING when every unit already says the right thing", () => {
    // Idempotence, which is the property that keeps a boot cheap: no rewrite,
    // no daemon-reload, no restart, on every boot after the first.
    const w = oneApp({ wrote: DOMAIN, domain: DOMAIN });
    const report = reconcileAppUrls(w.deps);
    expect(w.calls).toEqual([]);
    expect(report.converged).toEqual([]);
    expect(report.restarted).toEqual([]);
  });

  it("does nothing on the SECOND pass after a real convergence", () => {
    // The same claim end to end: the first pass leaves the world in a state
    // the second pass recognises as finished.
    const w = oneApp({ wrote: null, domain: DOMAIN });
    reconcileAppUrls(w.deps);
    w.calls.length = 0;
    const second = reconcileAppUrls(w.deps);
    expect(w.calls).toEqual([]);
    expect(second.converged).toEqual([]);
  });

  it("treats an EMPTY assignment as drift, in both directions", () => {
    // `BUREAU_APP_URL=` is not the same as no variable at all: an app testing
    // for it sees an empty string and believes it has no address... or worse,
    // builds a URL out of one. Both arms must rewrite.
    const emptyUnit = '[Service]\nEnvironment="BUREAU_APP_URL="\n';

    const off = oneApp({ wrote: null, domain: null });
    off.units.set("hello", emptyUnit);
    reconcileAppUrls(off.deps);
    expect(off.calls).toContain("regenerate:hello");
    expect(off.units.get("hello")).not.toContain("BUREAU_APP_URL");

    const on = oneApp({ wrote: null, domain: DOMAIN });
    on.units.set("hello", emptyUnit);
    reconcileAppUrls(on.deps);
    expect(on.units.get("hello")).toContain('Environment="BUREAU_APP_URL=https://hello.office.example"');
  });

  it("takes back an address a tailnet office should never have given out", () => {
    // The regression, end to end. This office IS on HTTPS - Tailscale Serve
    // terminates TLS - so it derived a domain and wrote
    // `https://hello.auntie.parrot-fish.ts.net` into every app's unit. That
    // name resolves nowhere: MagicDNS has no wildcards. The domain comes from
    // the PRODUCTION derivation here rather than a literal null, so this test
    // is wired to the fix and not to a restatement of it: with the tailnet
    // guard gone the derivation answers with the host, the seeded unit already
    // agrees with it, and the pass below has nothing to do.
    const lying = deriveAppHostDomain(TAILNET_ORIGIN, true);
    expect(lying).toBeNull();

    const app = record();
    const w = world({ apps: [app], domain: lying });
    w.units.set(app.name, unitFor(app, TAILNET_HOST));
    w.states.set(app.name, "running");
    expect(w.units.get("hello")).toContain('Environment="BUREAU_APP_URL=https://hello.auntie.parrot-fish.ts.net"');

    const report = reconcileAppUrls(w.deps);

    // The variable is GONE - not emptied - and the app that was serving is
    // restarted into the environment without it, exactly once.
    expect(w.units.get("hello")).not.toContain("BUREAU_APP_URL");
    expect(w.calls).toEqual(["regenerate:hello", "restart:hello"]);
    expect(report.restarted).toEqual(["hello"]);
    expect(report.failed).toEqual([]);

    // And the next boot is free: the cleanup is a one-time transition, not a
    // bounce every app pays on every start.
    w.calls.length = 0;
    const second = reconcileAppUrls(w.deps);
    expect(w.calls).toEqual([]);
    expect(second.converged).toEqual([]);
  });

  it("judges by the LAST assignment when a unit has been hand-edited", () => {
    const app = record();
    const w = oneApp({ wrote: DOMAIN, domain: DOMAIN });
    // A correct line followed by an emptying one: systemd gives the app the
    // empty value, so this unit is drift even though it contains the right
    // string.
    w.units.set(app.name, `${unitFor(app, DOMAIN)}Environment="BUREAU_APP_URL="\n`);
    reconcileAppUrls(w.deps);
    expect(w.calls).toContain("regenerate:hello");
    expect(w.units.get("hello")).toBe(unitFor(app, DOMAIN));
  });
});
