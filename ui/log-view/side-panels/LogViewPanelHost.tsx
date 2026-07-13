import type { useLogViewPanels } from "../hooks/useLogViewPanels.ts";
import { DesktopEditorSidePanel, DesktopTerminalSidePanel, MobileEditorSidePanel, MobileTerminalSidePanel } from "../LogViewSidePanels.tsx";

export function LogViewPanelHost({
  agentId,
  isMobile,
  terminalEnabled,
  editorEnabled,
  panels,
}: {
  agentId: string;
  isMobile: boolean;
  terminalEnabled: boolean;
  editorEnabled: boolean;
  panels: ReturnType<typeof useLogViewPanels>;
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
        />
      )}
      {isMobile && terminalEnabled && panels.terminalOpen && <MobileTerminalSidePanel agentId={agentId} onClose={() => panels.setTerminalOpen(false)} />}
      {isMobile && editorEnabled && panels.editorOpen && (
        <MobileEditorSidePanel agentId={agentId} initialPath={panels.editorInitialPath} onClose={() => panels.setEditorOpen(false)} onPathOpened={panels.clearEditorInitialPath} />
      )}
    </>
  );
}
