interface QueryParser {
  registerCsiHandler(id: { prefix?: string; intermediates?: string; final: string }, callback: (params: (number | number[])[]) => boolean): { dispose(): void };
  registerDcsHandler(id: { prefix?: string; intermediates?: string; final: string }, callback: (data: string, params: (number | number[])[]) => boolean): { dispose(): void };
  registerOscHandler(ident: number, callback: (data: string) => boolean): { dispose(): void };
}

export interface GuardableTerminal {
  parser: QueryParser;
  write(data: string, callback?: () => void): void;
}

export interface ReplayGuard {
  writeReplay(data: string, done?: () => void): void;
  suppressing(): boolean;
  dispose(): void;
}

const COLOR_OSC_IDENTS = [4, 10, 11, 12];
const WINDOW_REPORT_OPS = [14, 16, 18];

function isColorQuery(data: string): boolean {
  return data.split(";").some((part) => part === "?");
}

function firstParam(params: (number | number[])[]): number {
  const first = params[0];
  return Array.isArray(first) ? (first[0] ?? 0) : (first ?? 0);
}

export function installReplayGuard(term: GuardableTerminal): ReplayGuard {
  let pending = 0;
  const suppressing = () => pending > 0;

  const parser = term.parser;
  const disposables = [
    parser.registerCsiHandler({ final: "c" }, suppressing),
    parser.registerCsiHandler({ prefix: ">", final: "c" }, suppressing),
    parser.registerCsiHandler({ final: "n" }, suppressing),
    parser.registerCsiHandler({ prefix: "?", final: "n" }, suppressing),
    parser.registerCsiHandler({ intermediates: "$", final: "p" }, suppressing),
    parser.registerCsiHandler({ prefix: "?", intermediates: "$", final: "p" }, suppressing),
    parser.registerDcsHandler({ intermediates: "$", final: "q" }, suppressing),
    parser.registerCsiHandler({ final: "t" }, (params) => suppressing() && WINDOW_REPORT_OPS.includes(firstParam(params))),
    ...COLOR_OSC_IDENTS.map((ident) => parser.registerOscHandler(ident, (data) => suppressing() && isColorQuery(data))),
  ];

  return {
    writeReplay(data, done) {
      pending++;
      term.write(data, () => {
        pending--;
        done?.();
      });
    },
    suppressing,
    dispose() {
      for (const disposable of disposables) disposable.dispose();
    },
  };
}
