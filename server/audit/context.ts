import { AsyncLocalStorage } from "node:async_hooks";

export interface AuditContext {
  actor: string;
  operation: string;
  closed?: boolean;
}
export const auditContext = new AsyncLocalStorage<AuditContext>();

export function withAuditContext<T>(context: AuditContext, work: () => T): T {
  const scope = { ...context, closed: false };
  try {
    const result = auditContext.run(scope, work);
    if (result instanceof Promise)
      return result.finally(() => {
        scope.closed = true;
      }) as T;
    scope.closed = true;
    return result;
  } catch (error) {
    scope.closed = true;
    throw error;
  }
}
