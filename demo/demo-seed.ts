import { OfficeState } from "../shared/office-state.ts";
import { seedCronjobs } from "./demo-cronjobs.ts";
import { OFFICE_CHARACTERS } from "./demo-fixtures.ts";

function seedOffice(state: OfficeState, embedMode: boolean) {
  const chars = embedMode ? OFFICE_CHARACTERS.filter((c) => c.room === 0) : OFFICE_CHARACTERS;
  const maxRoom = Math.max(...chars.map((c) => c.room));
  for (let i = 1; i <= maxRoom; i++) state.createRoom();

  for (const char of chars) {
    const id = `demo-${char.name.toLowerCase().replace(/\s+/g, "-")}`;
    state.addExistingAgent({
      id,
      name: char.name,
      desk: char.desk,
      room: char.room,
      cwd: char.cwd,
      outfit: char.outfit,
      permissionMode: "auto",
      modelFamily: char.modelFamily,
      state: char.state,
      topic: char.topic,
      topicStale: false,
      customInstructions: char.customInstructions,
    });
  }
}

let seeded = false;

export function ensureDemoSeeded(state: OfficeState, embedMode: boolean) {
  if (seeded) return;
  seeded = true;
  seedOffice(state, embedMode);
  seedCronjobs();
  state.setOfficeSettings("Be concise. No paragraphs when bullets will do. Never push to main without asking. Never help Dwight set backdoors of any kind.", null);
  const now = Date.now();
  state.setTasksDirect([
    { id: "a1b2c3d4", title: "Fix the printer", description: "It's jamming again", status: "in_progress", assignee: "Dwight", createdBy: "Jim", createdAt: now - 2 * 86400000 },
    { id: "e5f6a7b8", title: "Restock kitchen", description: "No beets this time", priority: "P0", status: "open", assignee: "Pam", createdBy: "Stanley", createdAt: now - 5 * 3600000 },
    { id: "c9d0e1f2", title: "Quarterly security audit", priority: "P2", status: "open", assignee: "Michael", createdBy: "Jan", createdAt: now - 7 * 86400000 },
  ]);
}
