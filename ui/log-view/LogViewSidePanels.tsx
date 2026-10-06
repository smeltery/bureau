import { EditorPanel } from "./EditorPanel.tsx";
import { PANEL_MIN } from "./hooks/useSidePanelLayout.ts";
import { PanelResizer } from "./PanelResizer.tsx";
import { TerminalPanel } from "./TerminalPanel.tsx";

export function DesktopTerminalSidePanel({
  agentId,
  panelRef,
  width,
  getMax,
  onCommit,
  onClose,
  onSendToChat,
}: {
  agentId: string;
  panelRef: React.RefObject<HTMLDivElement | null>;
  width: number;
  getMax: () => number;
  onCommit: (width: number) => void;
  onClose: () => void;
  onSendToChat?: (text: string) => void;
}) {
  return (
    <div ref={panelRef} style={{ width, flexShrink: 0, position: "relative" }}>
      <PanelResizer panelRef={panelRef} min={PANEL_MIN.terminal} getMax={getMax} onCommit={onCommit} />
      <TerminalPanel agentId={agentId} onClose={onClose} onSendToChat={onSendToChat} />
    </div>
  );
}

export function DesktopEditorSidePanel({
  agentId,
  panelRef,
  width,
  getMax,
  onCommit,
  initialPath,
  onClose,
  onPathOpened,
  onCite,
}: {
  agentId: string;
  panelRef: React.RefObject<HTMLDivElement | null>;
  width: number;
  getMax: () => number;
  onCommit: (width: number) => void;
  initialPath: string | null;
  onClose: () => void;
  onPathOpened: () => void;
  onCite?: (text: string, title: string) => void;
}) {
  return (
    <div ref={panelRef} style={{ width, flexShrink: 0, position: "relative" }}>
      <PanelResizer panelRef={panelRef} min={PANEL_MIN.editor} getMax={getMax} onCommit={onCommit} />
      <EditorPanel agentId={agentId} initialPath={initialPath} onClose={onClose} onPathOpened={onPathOpened} onCite={onCite} />
    </div>
  );
}

export function MobileTerminalSidePanel({ agentId, onClose, onSendToChat }: { agentId: string; onClose: () => void; onSendToChat?: (text: string) => void }) {
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: "100%",
        paddingTop: "env(safe-area-inset-top, 0px)",
        boxSizing: "border-box",
        background: "var(--bg-base)",
        zIndex: 30,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <TerminalPanel agentId={agentId} onClose={onClose} onSendToChat={onSendToChat} mobile />
    </div>
  );
}

export function MobileEditorSidePanel({ agentId, initialPath, onClose, onPathOpened }: { agentId: string; initialPath: string | null; onClose: () => void; onPathOpened: () => void }) {
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: "100%",
        paddingTop: "env(safe-area-inset-top, 0px)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
        boxSizing: "border-box",
        background: "var(--bg-base)",
        zIndex: 30,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <EditorPanel agentId={agentId} initialPath={initialPath} onClose={onClose} onPathOpened={onPathOpened} mobile />
    </div>
  );
}
