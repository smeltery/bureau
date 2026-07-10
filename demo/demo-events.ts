import type { OfficeEvent } from "../shared/office-state.ts";
import { shimEmit } from "../ui/ws.ts";

export function emitEvents(events: OfficeEvent[]) {
  for (const event of events) {
    switch (event.type) {
      case "agent_added":
        shimEmit({ type: "agent_added", agent: event.agent });
        shimEmit({ type: "slash_commands", agentId: event.agent.id, commands: [], skills: [] });
        break;
      case "agent_removed":
        shimEmit({ type: "agent_removed", agentId: event.agentId });
        break;
      case "agent_updated":
        shimEmit({ type: "agent_updated", agentId: event.agentId, changes: event.changes });
        break;
      case "room_created":
        shimEmit({ type: "room_created", room: event.room });
        break;
      case "room_renamed":
        shimEmit({ type: "room_renamed", roomId: event.roomId, name: event.name });
        break;
      case "room_closed":
        shimEmit({ type: "room_closed", roomId: event.roomId });
        break;
      case "room_settings_updated":
        shimEmit({ type: "room_settings_updated", roomId: event.roomId, prompt: event.prompt, envFile: event.envFile });
        break;
      case "office_settings_updated":
        shimEmit({ type: "office_settings_updated", prompt: event.prompt, envFile: event.envFile });
        break;
      case "tasks_changed":
        shimEmit({ type: "tasks", tasks: event.tasks });
        break;
    }
  }
}
