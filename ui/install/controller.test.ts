import { expect, test } from "bun:test";
import { createInstallController } from "./controller.ts";
function fixture(outcome: "accepted" | "dismissed" = "accepted", fail = false) {
  const target = new EventTarget(),
    controller = createInstallController(target);
  let calls = 0;
  const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
    prompt: async () => {
      calls++;
      if (fail) throw new Error("not available");
    },
    userChoice: Promise.resolve({ outcome }),
  });
  return { target, controller, event, calls: () => calls };
}
test("captures before subscribers mount and consumes each browser prompt once", async () => {
  const f = fixture();
  f.target.dispatchEvent(f.event);
  expect(f.event.defaultPrevented).toBe(true);
  expect(f.controller.snapshot()).toBe("ready");
  const first = f.controller.install();
  expect(await f.controller.install()).toBe("unavailable");
  expect(await first).toBe("accepted");
  expect(f.calls()).toBe(1);
  expect(f.controller.snapshot()).toBe("installed");
  f.controller.dispose();
});
test("dismissal and failures release the event, and a later event can be used", async () => {
  const f = fixture("dismissed");
  f.target.dispatchEvent(f.event);
  expect(await f.controller.install()).toBe("dismissed");
  expect(f.controller.snapshot()).toBe("unavailable");
  const failure = fixture("accepted", true);
  f.target.dispatchEvent(failure.event);
  await expect(f.controller.install()).rejects.toThrow();
  expect(f.controller.snapshot()).toBe("unavailable");
  f.target.dispatchEvent(f.event);
  expect(f.controller.snapshot()).toBe("ready");
  f.target.dispatchEvent(new Event("appinstalled"));
  expect(f.controller.snapshot()).toBe("installed");
  f.controller.dispose();
  failure.controller.dispose();
});
test("subscriptions and capture listeners detach cleanly", () => {
  const f = fixture();
  let updates = 0;
  const unsubscribe = f.controller.subscribe(() => updates++);
  f.target.dispatchEvent(f.event);
  expect(updates).toBe(1);
  unsubscribe();
  f.target.dispatchEvent(f.event);
  expect(updates).toBe(1);
  f.controller.dispose();
  const event = new Event("beforeinstallprompt", { cancelable: true });
  f.target.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
});
