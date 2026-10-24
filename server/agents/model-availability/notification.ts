import { createHash } from "node:crypto";
import type { AgentInfo } from "../../../shared/types.ts";
import { displayLogText, logContent, logMessage } from "../../../shared/i18n/log-message.ts";
import { providerDetail } from "../../backends/opencode/connection/provider-details.ts";
import { getUserById } from "../../users.ts";
import { raisePage } from "../../pager/store.ts";
import { pagerDeliveryDeps } from "../../pager/routes.ts";
import { sendPage } from "../../pager/delivery.ts";
import { addLogEntry, officeConfig, rooms } from "../state.ts";

export async function notifyMissingModel(info: AgentInfo): Promise<void> {
  const model = providerDetail(info.modelFamily) ?? "OpenCode";
  const message = logMessage("logs.backend.modelRemoved", { model });
  addLogEntry(info.id, "system", message, { pickModel: true });
  if (officeConfig.receptionistAgentId !== info.id || !info.userId) return;
  const language = getUserById(info.userId)?.language ?? "en";
  const title = logContent(message);
  const body = logContent(logMessage("logs.backend.receptionistModelRemoved", { name: info.name }));
  const { entry, created } = raisePage({
    source: { kind: "agent", id: info.id, name: info.name, roomId: rooms[info.room]?.id ?? null },
    targetUserId: info.userId,
    title: Array.from(displayLogText(title.content, title.message, language))
      .slice(0, 200)
      .join(""),
    body: displayLogText(body.content, body.message, language),
    key: `model-unavailable:${createHash("sha256").update(info.modelFamily).digest("hex")}`,
  });
  pagerDeliveryDeps.changed();
  if (created) await sendPage(entry, "page", pagerDeliveryDeps);
}
