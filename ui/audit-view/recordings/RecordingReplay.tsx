import { useI18n } from "../../i18n.tsx";
import { keyFrom } from "../../../shared/i18n/translate.ts";
import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import type { RecordingView, RecordingEvent } from "../../../shared/terminal/recordings.ts";

const END_KEYS = { disabled: "auditUi.disabled", serverStopped: "auditUi.serverStopped", sizeLimit: "auditUi.sizeLimit", terminalClosed: "auditUi.terminalClosed" } as const;

export function RecordingReplay({ recording, onClose }: { recording: RecordingView; onClose: () => void }) {
  const { t, language } = useI18n();
  const container = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const cursor = useRef(0);
  const elapsed = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [typist, setTypist] = useState<Extract<RecordingEvent, { type: "typist" }> | null>(null);
  const duration = recording.events.at(-1)?.at ?? 0;
  function advance(target: number) {
    const term = terminal.current;
    if (!term) return;
    while (cursor.current < recording.events.length && recording.events[cursor.current]!.at <= target) {
      const event = recording.events[cursor.current++]!;
      if (event.type === "output") term.write(event.data);
      if (event.type === "resize") term.resize(event.cols, event.rows);
      if (event.type === "typist") setTypist(event);
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
  const endKey = end?.type === "end" && end.reasonCode ? keyFrom(END_KEYS, end.reasonCode) : undefined;
  return (
    <section aria-label={t("auditUi.replayLabel")} style={{ padding: 12, border: "1px solid var(--border-subtle)" }}>
      <h3>{t("auditUi.recordedAt", { date: new Date(recording.header.startedAt).toLocaleString(language) })}</h3>
      <p>{t("auditUi.snapshot", { status: recording.active ? t("auditUi.stillRecording") : endKey ? t(endKey) : end?.type === "end" ? end.reason : t("auditUi.interrupted") })}</p>
      <button onClick={() => setPlaying(!playing)} disabled={position >= duration}>
        {playing ? t("auditUi.pause") : t("auditUi.play")}
      </button>{" "}
      <button
        onClick={() => {
          setPlaying(false);
          terminal.current?.reset();
          terminal.current?.resize(recording.header.cols, recording.header.rows);
          cursor.current = 0;
          setTypist(null);
          advance(0);
        }}
      >
        {t("auditUi.restart")}
      </button>{" "}
      <button
        onClick={() => {
          setPlaying(false);
          advance(duration);
        }}
      >
        {t("auditUi.finalOutput")}
      </button>{" "}
      <button onClick={onClose}>{t("auditUi.closeReplay")}</button>
      <p>
        {t("auditUi.seconds", { position: Math.floor(position / 1000).toLocaleString(language), duration: Math.floor(duration / 1000).toLocaleString(language) })}
        {typist && ` · ${t("auditUi.lastInput", { actor: typist.unknownActor ? t("auditUi.unknownMember") : typist.actor })}`}
      </p>
      <div ref={container} style={{ overflow: "auto", maxHeight: 480 }} />
    </section>
  );
}
