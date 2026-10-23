import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import type { RecordingView } from "../../../shared/terminal/recordings.ts";

export function RecordingReplay({ recording, onClose }: { recording: RecordingView; onClose: () => void }) {
  const container = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const cursor = useRef(0);
  const elapsed = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [typist, setTypist] = useState("");
  const duration = recording.events.at(-1)?.at ?? 0;
  function advance(target: number) {
    const term = terminal.current;
    if (!term) return;
    while (cursor.current < recording.events.length && recording.events[cursor.current]!.at <= target) {
      const event = recording.events[cursor.current++]!;
      if (event.type === "output") term.write(event.data);
      if (event.type === "resize") term.resize(event.cols, event.rows);
      if (event.type === "typist") setTypist(event.actor);
    }
    elapsed.current = target;
    setPosition(target);
  }
  useEffect(() => {
    const term = new Terminal({ cols: recording.header.cols, rows: recording.header.rows, disableStdin: true, cursorBlink: false, fontSize: 12, scrollback: 5000 });
    terminal.current = term;
    if (container.current) term.open(container.current);
    advance(0);
    return () => {
      term.dispose();
      terminal.current = null;
    };
  }, [recording]);
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      const next = Math.min(duration, elapsed.current + now - last);
      last = now;
      advance(next);
      if (next >= duration) setPlaying(false);
    }, 50);
    return () => clearInterval(timer);
  }, [playing, recording]);
  const end = recording.events.findLast((event) => event.type === "end");
  return (
    <section aria-label="Terminal recording replay" style={{ padding: 12, border: "1px solid var(--border-subtle)" }}>
      <h3>Terminal recording · {new Date(recording.header.startedAt).toLocaleString()}</h3>
      <p>Read-only snapshot · {recording.active ? "Still recording; reopen to refresh" : end?.type === "end" ? end.reason : "Interrupted recording"}</p>
      <button onClick={() => setPlaying(!playing)} disabled={position >= duration}>
        {playing ? "Pause" : "Play"}
      </button>{" "}
      <button
        onClick={() => {
          setPlaying(false);
          terminal.current?.reset();
          terminal.current?.resize(recording.header.cols, recording.header.rows);
          cursor.current = 0;
          setTypist("");
          advance(0);
        }}
      >
        Restart replay
      </button>{" "}
      <button
        onClick={() => {
          setPlaying(false);
          advance(duration);
        }}
      >
        Show final output
      </button>{" "}
      <button onClick={onClose}>Close replay</button>
      <p>
        {Math.floor(position / 1000)} / {Math.floor(duration / 1000)} seconds{typist && ` · Last input by ${typist}`}
      </p>
      <div ref={container} style={{ overflow: "auto", maxHeight: 480 }} />
    </section>
  );
}
