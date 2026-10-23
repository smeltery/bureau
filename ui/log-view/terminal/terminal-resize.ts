type Size = { cols: number; rows: number };
type Schedule = (callback: () => void, delayMs: number) => () => void;

const scheduleTimeout: Schedule = (callback, delayMs) => {
  const timer = setTimeout(callback, delayMs);
  return () => clearTimeout(timer);
};

export function createTerminalResizer(send: (cols: number, rows: number) => void, schedule: Schedule = scheduleTimeout) {
  let cancel: (() => void) | undefined;
  let last: Size | undefined;
  let disposed = false;

  function sendNow(cols: number, rows: number, force = false) {
    cancel?.();
    cancel = undefined;
    if (disposed || (!force && last?.cols === cols && last.rows === rows)) return;
    last = { cols, rows };
    send(cols, rows);
  }

  return {
    sendNow,
    request(cols: number, rows: number) {
      cancel?.();
      cancel = undefined;
      if (disposed || (last?.cols === cols && last.rows === rows)) return;
      cancel = schedule(() => sendNow(cols, rows), 120);
    },
    dispose() {
      disposed = true;
      cancel?.();
      cancel = undefined;
    },
  };
}

export type TerminalResizer = ReturnType<typeof createTerminalResizer>;
