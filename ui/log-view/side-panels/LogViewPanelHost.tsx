import type { useLogViewPanels } from "../hooks/useLogViewPanels.ts";
import { DesktopEditorSidePanel, DesktopTerminalSidePanel, MobileEditorSidePanel, MobileTerminalSidePanel } from "../LogViewSidePanels.tsx";

export function LogViewPanelHost({
  agentId,
  isMobile,
  terminalEnabled,
  editorEnabled,
  panels,
  onSendTerminalToChat,
  onCiteEditorSelection,
}: {
  agentId: string;
  isMobile: boolean;
  terminalEnabled: boolean;
  editorEnabled: boolean;
  panels: ReturnType<typeof useLogViewPanels>;
  onSendTerminalToChat?: (text: string) => void;
  onCiteEditorSelection?: (text: string, title: string) => void;
}) {
  return (
    <>
      {terminalEnabled && !isMobile && panels.terminalOpen && (
        <DesktopTerminalSidePanel
          agentId={agentId}
          panelRef={panels.terminalContainerRef}
          width={panels.terminalWidth}
          getMax={panels.getTerminalMax}
          onCommit={panels.commitTerminalWidth}
          onClose={() => panels.setTerminalOpen(false)}
          onSendToChat={onSendTerminalToChat}
        />
      )}
      {editorEnabled && !isMobile && panels.editorOpen && (
        <DesktopEditorSidePanel
          agentId={agentId}
          panelRef={panels.editorContainerRef}
          width={panels.editorWidth}
          getMax={panels.getEditorMax}
          onCommit={panels.commitEditorWidth}
          initialPath={panels.editorInitialPath}
          onClose={() => panels.setEditorOpen(false)}
          onPathOpened={panels.clearEditorInitialPath}
          onCite={onCiteEditorSelection}
        />
      )}
      {isMobile && terminalEnabled && panels.terminalOpen && <MobileTerminalSidePanel agentId={agentId} onClose={() => panels.setTerminalOpen(false)} onSendToChat={onSendTerminalToChat} />}
      {isMobile && editorEnabled && panels.editorOpen && (
        <MobileEditorSidePanel agentId={agentId} initialPath={panels.editorInitialPath} onClose={() => panels.setEditorOpen(false)} onPathOpened={panels.clearEditorInitialPath} />
      )}
    </>
  );
}
