import { describe, expect, test } from "bun:test";
import { installReplayGuard, type GuardableTerminal } from "./terminal-replay-guard.ts";

type CsiRegistration = {
  id: { prefix?: string; intermediates?: string; final: string };
  callback: (params: (number | number[])[]) => boolean;
  disposed: boolean;
};

type DcsRegistration = {
  id: { prefix?: string; intermediates?: string; final: string };
  callback: (data: string, params: (number | number[])[]) => boolean;
  disposed: boolean;
};

type OscRegistration = {
  ident: number;
  callback: (data: string) => boolean;
  disposed: boolean;
};

function makeTerminal() {
  const writes: string[] = [];
  const csi: CsiRegistration[] = [];
  const dcs: DcsRegistration[] = [];
  const osc: OscRegistration[] = [];
  const term: GuardableTerminal = {
    parser: {
      registerCsiHandler(id, callback) {
        const registration = { id, callback, disposed: false };
        csi.push(registration);
        return { dispose: () => (registration.disposed = true) };
      },
      registerDcsHandler(id, callback) {
        const registration = { id, callback, disposed: false };
        dcs.push(registration);
        return { dispose: () => (registration.disposed = true) };
      },
      registerOscHandler(ident, callback) {
        const registration = { ident, callback, disposed: false };
        osc.push(registration);
        return { dispose: () => (registration.disposed = true) };
      },
    },
    write(data, callback) {
      writes.push(data);
      callback?.();
    },
  };
  return { term, writes, csi, dcs, osc };
}

describe("installReplayGuard", () => {
  test("suppresses terminal query handlers only while replay is being parsed", () => {
    const { term, writes, csi } = makeTerminal();
    const guard = installReplayGuard(term);
    const cursorPositionReport = csi.find((handler) => handler.id.final === "n" && !handler.id.prefix);

    expect(cursorPositionReport?.callback([6])).toBe(false);
    guard.writeReplay("scrollback");
    expect(writes).toEqual(["scrollback"]);
    expect(guard.suppressing()).toBe(false);

    let duringReplay = false;
    term.write = (_data, callback) => {
      duringReplay = cursorPositionReport?.callback([6]) ?? false;
      callback?.();
    };
    guard.writeReplay("scrollback again");
    expect(duringReplay).toBe(true);
    expect(cursorPositionReport?.callback([6])).toBe(false);
  });

  test("suppresses only replayed color queries and report-style window ops", () => {
    const { term, csi, osc } = makeTerminal();
    const guard = installReplayGuard(term);
    const backgroundColor = osc.find((handler) => handler.ident === 11);
    const windowOps = csi.find((handler) => handler.id.final === "t");

    let duringReplayColorQuery = false;
    let duringReplayColorSet = false;
    let duringReplayReport = false;
    let duringReplayResize = false;
    term.write = (_data, callback) => {
      duringReplayColorQuery = backgroundColor?.callback("?") ?? false;
      duringReplayColorSet = backgroundColor?.callback("#ff0000") ?? false;
      duringReplayReport = windowOps?.callback([18]) ?? false;
      duringReplayResize = windowOps?.callback([8]) ?? false;
      callback?.();
    };

    guard.writeReplay("scrollback");
    expect(duringReplayColorQuery).toBe(true);
    expect(duringReplayColorSet).toBe(false);
    expect(duringReplayReport).toBe(true);
    expect(duringReplayResize).toBe(false);
  });

  test("disposes every registered parser handler", () => {
    const { term, csi, dcs, osc } = makeTerminal();
    const guard = installReplayGuard(term);

    guard.dispose();

    expect([...csi, ...dcs, ...osc].every((handler) => handler.disposed)).toBe(true);
  });
});
