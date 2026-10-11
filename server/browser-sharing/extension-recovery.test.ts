import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { join } from "node:path";

async function fixture(options: { changedTarget?: boolean; changedOrigin?: boolean; lateAttach?: boolean } = {}) {
  const calls: string[] = [];
  let onDetach: (source: { tabId: number }, reason: string) => void = () => {};
  const origin = "https://offered.example";
  const grant = { id: "grant", tabId: 1, targetId: "page-1", origin, expiresAt: null };
  const noop = async () => {};
  const context = createContext({
    URL,
    AbortSignal,
    console,
    fixtureGrant: grant,
    setTimeout: (callback: () => void, delay: number) => setTimeout(callback, delay === 3000 ? 15 : delay),
    clearTimeout,
    setInterval: () => 0,
    chrome: {
      debugger: {
        onEvent: { addListener: () => {} },
        onDetach: {
          addListener: (callback: typeof onDetach) => {
            onDetach = callback;
          },
        },
        getTargets: async () => [{ tabId: 1, type: "page", id: options.changedTarget ? "replacement" : "page-1" }],
        attach: async () => {
          calls.push("attach");
          if (options.lateAttach) await Bun.sleep(40);
        },
        detach: async () => {
          calls.push("detach");
        },
        sendCommand: async (_target: unknown, method: string) => {
          calls.push(method);
          return method === "Target.getTargetInfo" ? { targetInfo: { targetId: "page-1" } } : { frameTree: { frame: { url: origin } } };
        },
      },
      tabs: { get: async () => ({ id: 1, url: options.changedOrigin ? "https://other.example" : origin }), onRemoved: { addListener: () => {} }, onUpdated: { addListener: () => {} } },
      storage: { local: { get: async () => ({}) }, session: { get: async () => ({}), set: noop } },
      action: { setBadgeText: noop, setBadgeBackgroundColor: noop },
      alarms: { create: noop, onAlarm: { addListener: () => {} } },
      runtime: { onMessage: { addListener: () => {} } },
    },
  });
  context.importScripts = (...names: string[]) => {
    for (const name of names) runInContext(readFileSync(join(import.meta.dir, "../../browser-extension", name), "utf8"), context);
  };
  runInContext(readFileSync(join(import.meta.dir, "../../browser-extension/worker.js"), "utf8"), context);
  await runInContext("ready", context);
  runInContext('grants.set("grant", fixtureGrant)', context);
  return { calls, context, grant, detach: onDetach, shared: () => runInContext('grants.has("grant")', context), recovered: () => runInContext('recoveringGrants.get("grant")', context) };
}

test("only a surviving page target recovers once; user detach still revokes", async () => {
  const f = await fixture();
  f.detach({ tabId: 1 }, "target_closed");
  await f.recovered();
  expect(f.shared()).toBe(true);
  expect(f.calls.filter((call) => call === "attach")).toHaveLength(1);
  f.detach({ tabId: 1 }, "target_closed");
  await Bun.sleep(1);
  expect(f.shared()).toBe(false);
  expect(f.calls.filter((call) => call === "attach")).toHaveLength(1);
  const manual = await fixture();
  manual.detach({ tabId: 1 }, "canceled_by_user");
  expect(manual.shared()).toBe(false);
  expect(manual.calls).not.toContain("attach");
});

test("changed origins, replacement targets and late attachments lose their grants", async () => {
  for (const options of [{ changedTarget: true }, { changedOrigin: true }, { lateAttach: true }]) {
    const f = await fixture(options);
    f.detach({ tabId: 1 }, "target_closed");
    await f.recovered();
    expect(f.shared()).toBe(false);
    if (options.lateAttach) {
      await Bun.sleep(50);
      expect(f.calls.filter((call) => call === "detach").length).toBeGreaterThanOrEqual(2);
    } else expect(f.calls).not.toContain("attach");
  }
});

test("detachment interrupts a stalled action and never resumes its input", async () => {
  const f = await fixture();
  let release: (value: unknown) => void = () => {};
  f.context.chrome.debugger.sendCommand = (_target: unknown, method: string) => {
    f.calls.push(method);
    return new Promise((resolve) => {
      release = resolve;
    });
  };
  const action = runInContext('execute({tabId:1, origin:"https://offered.example", input:{action:"click",selector:"#button"}}).catch(error => error.message)', f.context);
  f.detach({ tabId: 1 }, "canceled_by_user");
  expect(await action).toContain("outcome is unknown");
  release({ frameTree: { frame: { url: "https://offered.example" } } });
  await Bun.sleep(1);
  expect(f.calls).not.toContain("Input.dispatchMouseEvent");
});
