import type { IntegrationScope } from "../../shared/integrations/connections.ts";

type ChangeHandler = (scope: IntegrationScope) => void | Promise<void>;
const handlers = new Set<ChangeHandler>();
export function onIntegrationChange(handler: ChangeHandler): () => void {
  handlers.add(handler);
  return () => handlers.delete(handler);
}
export async function notifyIntegrationChange(scope: IntegrationScope): Promise<void> {
  for (const handler of handlers) {
    try {
      await handler(scope);
    } catch {
      console.error("[integrations] a committed change could not refresh the runtime");
    }
  }
}
