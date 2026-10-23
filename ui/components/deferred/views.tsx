import { Component, lazy, Suspense, type ComponentType, type ComponentProps, type ReactNode } from "react";

class LoadBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <div role="alert">
          This view could not load. Check your connection, then reload when you’re ready. <button onClick={() => window.location.reload()}>Reload</button>
        </div>
      );
    return this.props.children;
  }
}
function deferred<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  const View = lazy(load);
  return function DeferredView(props: ComponentProps<T>) {
    return (
      <LoadBoundary>
        <Suspense fallback={<div role="status">Loading view…</div>}>
          <View {...props} />
        </Suspense>
      </LoadBoundary>
    );
  };
}
export const TaskView = deferred(() => import("../../task-view/TaskView.tsx").then((m) => ({ default: m.TaskView })));
export const CronjobsView = deferred(() => import("../CronjobsView.tsx").then((m) => ({ default: m.CronjobsView })));
export const AppsView = deferred(() => import("../../apps-view/AppsView.tsx").then((m) => ({ default: m.AppsView })));
export const SkillsView = deferred(() => import("../../skills-view/SkillsView.tsx").then((m) => ({ default: m.SkillsView })));
export const PluginsView = deferred(() => import("../PluginsView.tsx").then((m) => ({ default: m.PluginsView })));
export const TeamChatView = deferred(() => import("../../team-chat/TeamChatView.tsx").then((m) => ({ default: m.TeamChatView })));
export const UserSettingsView = deferred(() => import("../UserSettingsView.tsx").then((m) => ({ default: m.UserSettingsView })));
