import type { RefObject } from "react";
import { MobileInputProxy } from "../terminal-mobile.tsx";
import { TerminalExitOverlay } from "../terminal-chrome.tsx";

export function TerminalPanelBody({
  bodyRef,
  containerRef,
  exited,
  inputProxyRef,
  mobile,
  onBodyTap,
  onRespawn,
  onSendInput,
}: {
  bodyRef: RefObject<HTMLDivElement | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  exited: number | null;
  inputProxyRef: RefObject<HTMLTextAreaElement | null>;
  mobile: boolean;
  onBodyTap: () => void;
  onRespawn: () => void;
  onSendInput: (data: string) => void;
}) {
  return (
    <div
      ref={bodyRef}
      className={mobile ? "bureau-mobile-term-body" : undefined}
      onClick={onBodyTap}
      style={{
        flex: 1,
        minHeight: 0,
        padding: 4,
        overflow: "hidden",
        position: "relative",
      }}
    >
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
      {mobile && <MobileInputProxy ref={inputProxyRef} onInput={onSendInput} />}
      {exited !== null && <TerminalExitOverlay exitCode={exited} onRestart={onRespawn} />}
    </div>
  );
}
