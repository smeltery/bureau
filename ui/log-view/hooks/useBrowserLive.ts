import { useCallback, useEffect, useRef, useState } from "react";
import type { BrowserHumanInput, ServerMessage } from "../../../shared/types.ts";
import { addRawListener, removeRawListener, send } from "../../ws.ts";

const BROWSER_MIN_DIM = 320;
const BROWSER_MAX_DIM = 2560;

let nextSelectionRequest = 0;

export function useBrowserLive(agentId: string) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [available, setAvailable] = useState(false);
  const [title, setTitle] = useState("");
  const [copyNote, setCopyNote] = useState("");
  const [copying, setCopying] = useState(false);
  const [liveError, setLiveError] = useState("");
  const [urlFromServer, setUrlFromServer] = useState<string | null>(null);
  const surfaceRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const held = useRef<{ x: number; y: number } | null>(null);
  const motion = useRef<BrowserHumanInput | null>(null);
  const motionTick = useRef<number | null>(null);
  const lastServerUrl = useRef<string | undefined>(undefined);
  const selectionRequest = useRef<{
    id: number;
    resolve: (v: { text: string; truncated: boolean }) => void;
    reject: () => void;
  } | null>(null);

  const input = useCallback(
    (value: BrowserHumanInput) => {
      send({ type: "browser_input", agentId, input: value });
    },
    [agentId],
  );

  useEffect(() => {
    const listener = (raw: string) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(raw) as ServerMessage;
      } catch {
        return;
      }
      const req = selectionRequest.current;
      if (!req || msg.type !== "browser_selection" || msg.agentId !== agentId || msg.requestId !== req.id) return;
      if (msg.error) req.reject();
      else req.resolve(msg);
    };
    addRawListener(listener);
    return () => {
      removeRawListener(listener);
      selectionRequest.current?.reject();
      selectionRequest.current = null;
    };
  }, [agentId]);

  useEffect(() => {
    let alive = true;
    let pending: { data: string; width: number; height: number } | null = null;
    let decoding = false;
    let generation = 0;
    let acceptsFrames = true;
    const decode = () => {
      if (!alive || decoding || !pending) return;
      const frame = pending;
      pending = null;
      decoding = true;
      const epoch = generation;
      const image = new Image();
      image.onload = () => {
        try {
          if (!alive || epoch !== generation || !surfaceRef.current) return;
          const canvas = surfaceRef.current;
          const w = image.naturalWidth || frame.width;
          const h = image.naturalHeight || frame.height;
          if (canvas.width !== w) canvas.width = w;
          if (canvas.height !== h) canvas.height = h;
          canvas.getContext("2d")?.drawImage(image, 0, 0, w, h);
          setSize((old) => (old?.width === frame.width && old.height === frame.height ? old : { width: frame.width, height: frame.height }));
        } finally {
          decoding = false;
          decode();
        }
      };
      image.onerror = () => {
        decoding = false;
        decode();
      };
      image.src = `data:image/jpeg;base64,${frame.data}`;
    };
    const captureBounds = {
      maxWidth: undefined as number | undefined,
      maxHeight: undefined as number | undefined,
      deviceScaleFactor: undefined as number | undefined,
    };
    const subscribe = () => {
      generation++;
      pending = null;
      send({ type: "browser_watch", agentId, watching: true, ...captureBounds });
    };
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver((entries) => {
            const rect = entries[0]?.contentRect;
            if (!rect || rect.width <= 0 || rect.height <= 0) return;
            if (resizeTimer) clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
              const dpr = Math.max(1, Math.min(4, window.devicePixelRatio || 1));
              const bound = (value: number) => Math.max(BROWSER_MIN_DIM, Math.min(BROWSER_MAX_DIM, Math.ceil((value * dpr) / 16) * 16));
              const next = { maxWidth: bound(rect.width), maxHeight: bound(rect.height), deviceScaleFactor: dpr };
              if (next.maxWidth === captureBounds.maxWidth && next.maxHeight === captureBounds.maxHeight && next.deviceScaleFactor === captureBounds.deviceScaleFactor) {
                return;
              }
              Object.assign(captureBounds, next);
              subscribe();
            }, 150);
          });
    if (viewportRef.current) observer?.observe(viewportRef.current);
    const listener = (raw: string) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(raw) as ServerMessage;
      } catch {
        return;
      }
      if (msg.type === "full_state") {
        subscribe();
        return;
      }
      if (!("agentId" in msg) || msg.agentId !== agentId) return;
      if (msg.type === "browser_frame") {
        if (!acceptsFrames) return;
        pending = msg;
        decode();
      } else if (msg.type === "browser_status") {
        acceptsFrames = msg.available;
        setAvailable(msg.available);
        if (msg.url !== undefined) {
          if (msg.url !== lastServerUrl.current) setCopyNote("");
          lastServerUrl.current = msg.url;
          if (msg.url && msg.url !== "about:blank") setUrlFromServer(msg.url);
        }
        if (msg.title !== undefined) setTitle(msg.title);
        if (msg.error) setLiveError(msg.error);
        if (!msg.available) {
          pending = null;
          generation++;
          setSize(null);
        }
      }
    };
    addRawListener(listener);
    subscribe();
    return () => {
      alive = false;
      if (resizeTimer) clearTimeout(resizeTimer);
      observer?.disconnect();
      send({ type: "browser_watch", agentId, watching: false });
      removeRawListener(listener);
    };
  }, [agentId]);

  const copySelection = async () => {
    if (selectionRequest.current) return;
    setCopyNote("");
    setLiveError("");
    if (!navigator.clipboard?.writeText) {
      setLiveError("Clipboard unavailable");
      return;
    }
    setCopying(true);
    const id = ++nextSelectionRequest;
    const isCurrent = () => selectionRequest.current?.id === id;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let reading = true;
    try {
      const selection = await new Promise<{ text: string; truncated: boolean }>((resolve, reject) => {
        selectionRequest.current = { id, resolve, reject: () => reject(new Error("selection_failed")) };
        timer = setTimeout(() => reject(new Error("selection_timeout")), 5000);
        input({ kind: "selection", requestId: id });
      });
      if (!isCurrent()) return;
      if (!selection.text) {
        setCopyNote("No selection");
        return;
      }
      reading = false;
      await navigator.clipboard.writeText(selection.text);
      if (isCurrent()) setCopyNote(selection.truncated ? "Copied (truncated)" : "Copied");
    } catch {
      if (isCurrent()) setLiveError(reading ? "Could not read selection" : "Copy failed");
    } finally {
      if (timer) clearTimeout(timer);
      if (isCurrent()) selectionRequest.current = null;
      setCopying(false);
    }
  };

  const flushMotion = useCallback(() => {
    if (motionTick.current !== null) cancelAnimationFrame(motionTick.current);
    motionTick.current = null;
    if (motion.current) input(motion.current);
    motion.current = null;
  }, [input]);

  const releaseHeld = useCallback(() => {
    if (!held.current) return;
    flushMotion();
    input({ kind: "mouse", event: "mouseReleased", ...held.current, button: "left", clickCount: 1 });
    held.current = null;
  }, [flushMotion, input]);

  useEffect(() => {
    window.addEventListener("blur", releaseHeld);
    return () => {
      window.removeEventListener("blur", releaseHeld);
      releaseHeld();
    };
  }, [releaseHeld]);

  const coordinates = (event: React.MouseEvent<HTMLCanvasElement>, clamp = false) => {
    if (!size) return null;
    const rect = event.currentTarget.getBoundingClientRect();
    const scale = Math.min(rect.width / size.width, rect.height / size.height);
    if (!scale) return null;
    const x = (event.clientX - rect.left - (rect.width - size.width * scale) / 2) / scale;
    const y = (event.clientY - rect.top - (rect.height - size.height * scale) / 2) / scale;
    if (!clamp && (x < 0 || y < 0 || x > size.width || y > size.height)) return null;
    return { x: Math.max(0, Math.min(size.width, x)), y: Math.max(0, Math.min(size.height, y)) };
  };

  const point = (event: React.PointerEvent<HTMLCanvasElement>, type: "mousePressed" | "mouseReleased" | "mouseMoved") => {
    if (!size) return;
    const position = coordinates(event, held.current !== null);
    if (!position) return;
    if (type === "mousePressed" || held.current) held.current = position;
    const value: BrowserHumanInput = {
      kind: "mouse",
      event: type,
      ...position,
      button: type === "mouseMoved" && !(event.buttons & 1) ? "none" : "left",
      clickCount: type === "mouseMoved" ? 0 : 1,
    };
    if (type === "mouseMoved") {
      motion.current = value;
      if (motionTick.current === null) motionTick.current = requestAnimationFrame(flushMotion);
    } else {
      flushMotion();
      input(value);
      if (type === "mouseReleased") held.current = null;
    }
  };

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    if (!size) return;
    const position = coordinates(e);
    if (!position) return;
    input({ kind: "mouse", event: "mouseWheel", ...position, deltaX: e.deltaX, deltaY: e.deltaY });
  };

  return {
    size,
    available,
    title,
    copyNote,
    copying,
    liveError,
    urlFromServer,
    surfaceRef,
    viewportRef,
    copySelection,
    point,
    onWheel,
    releaseHeld,
    coordinates,
    clearLiveError: () => setLiveError(""),
    clearCopyNote: () => setCopyNote(""),
  };
}
