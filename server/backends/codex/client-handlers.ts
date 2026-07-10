import type { NotificationHandler, ServerRequestHandler } from "./client-types.ts";

export class JsonRpcClientHandlers {
  readonly notificationHandlers = new Set<NotificationHandler>();
  readonly serverRequestHandlers: ServerRequestHandler[] = [];
  readonly stderrHandlers = new Set<(chunk: string) => void>();
  private readonly exitHandlers = new Set<(code: number | null, signal: NodeJS.Signals | null) => void>();
  private readonly closeHandlers = new Set<() => void>();

  onNotification(handler: NotificationHandler): () => void {
    this.notificationHandlers.add(handler);
    return () => {
      this.notificationHandlers.delete(handler);
    };
  }

  onServerRequest(handler: ServerRequestHandler): () => void {
    this.serverRequestHandlers.push(handler);
    return () => {
      const i = this.serverRequestHandlers.indexOf(handler);
      if (i >= 0) this.serverRequestHandlers.splice(i, 1);
    };
  }

  onStderr(handler: (chunk: string) => void): () => void {
    this.stderrHandlers.add(handler);
    return () => {
      this.stderrHandlers.delete(handler);
    };
  }

  onExit(handler: (code: number | null, signal: NodeJS.Signals | null) => void): () => void {
    this.exitHandlers.add(handler);
    return () => {
      this.exitHandlers.delete(handler);
    };
  }

  onClose(handler: () => void): () => void {
    this.closeHandlers.add(handler);
    return () => {
      this.closeHandlers.delete(handler);
    };
  }

  emitStderr(chunk: string): void {
    for (const h of this.stderrHandlers) {
      try {
        h(chunk);
      } catch {}
    }
  }

  emitExit(code: number | null, signal: NodeJS.Signals | null): void {
    for (const h of this.exitHandlers) {
      try {
        h(code, signal);
      } catch {}
    }
  }

  emitClose(): void {
    for (const h of this.closeHandlers) {
      try {
        h();
      } catch {}
    }
  }
}
