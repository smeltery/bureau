import type { LogEntry } from "../../shared/types.ts";
import type { BureauPlugin, PluginAfterTurnInput, PluginTurnContext } from "../../shared/plugin-types.ts";
import type { ManagedAgent } from "../agents/state.ts";
import type { TurnOrigin } from "./run-agent-turn.ts";
import { logPluginFailure } from "./failure-log.ts";

const BEFORE_TURN_TIMEOUT_MS = 5000;
const AFTER_TURN_TIMEOUT_MS = 10000;

export async function runBeforeTurnHooks(plugins: BureauPlugin[], ctx: PluginTurnContext, origin: TurnOrigin): Promise<Array<{ id: string; prefix: string }>> {
  const prefixes: Array<{ id: string; prefix: string }> = [];
  if (plugins.length === 0) return prefixes;

  const results = await Promise.all(
    plugins.map(async (plugin) => {
      const prefix = await runOneBeforeTurn(plugin, ctx, origin);
      return prefix ? { id: plugin.id, prefix } : null;
    }),
  );
  for (const r of results) {
    if (r) prefixes.push(r);
  }
  return prefixes;
}

export function runAfterTurn(plugins: BureauPlugin[], ctx: PluginTurnContext, input: PluginAfterTurnInput, origin: TurnOrigin, managed: ManagedAgent): Promise<void> {
  const settled: Promise<void> = Promise.all(plugins.map((p) => runOneAfterTurn(p, ctx, input, origin))).then(() => undefined);

  const self: Promise<void> = settled.finally(() => {
    if (managed.afterTurnPromise === self) {
      managed.afterTurnPromise = null;
    }
  });

  return self;
}

export function assistantTextFromEntries(entries: LogEntry[]): string {
  const parts: string[] = [];
  for (const e of entries) {
    if (e.kind !== "text") continue;
    if (typeof e.content !== "string") continue;
    const trimmed = e.content.trim();
    if (trimmed.length > 0) parts.push(trimmed);
  }
  return parts.join("\n\n");
}

async function runOneBeforeTurn(p: BureauPlugin, ctx: PluginTurnContext, origin: TurnOrigin): Promise<string | null> {
  if (!p.beforeTurn) return null;

  const start = Date.now();
  let timedOut = false;

  const work = (async () => {
    try {
      const r = await p.beforeTurn!(ctx);
      return r ?? null;
    } catch (err) {
      if (!timedOut) {
        logPluginFailure({
          pluginId: p.id,
          hook: "beforeTurn",
          agentId: ctx.agentId,
          roomId: ctx.roomId,
          origin,
          durationMs: Date.now() - start,
          error: err,
        });
      }
      return null;
    }
  })();

  const winner = await Promise.race([work.then((r) => ({ kind: "ok" as const, r })), new Promise<{ kind: "timeout" }>((res) => setTimeout(() => res({ kind: "timeout" }), BEFORE_TURN_TIMEOUT_MS))]);

  if (winner.kind === "timeout") {
    timedOut = true;
    logPluginFailure({
      pluginId: p.id,
      hook: "beforeTurn",
      agentId: ctx.agentId,
      roomId: ctx.roomId,
      origin,
      durationMs: BEFORE_TURN_TIMEOUT_MS,
      error: new Error(`beforeTurn timed out after ${BEFORE_TURN_TIMEOUT_MS}ms`),
    });
    return null;
  }

  return normalizeBeforeTurnResult(p, winner.r, ctx, origin, start);
}

function normalizeBeforeTurnResult(p: BureauPlugin, value: unknown, ctx: PluginTurnContext, origin: TurnOrigin, startMs: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    logPluginFailure({
      pluginId: p.id,
      hook: "beforeTurn",
      agentId: ctx.agentId,
      roomId: ctx.roomId,
      origin,
      durationMs: Date.now() - startMs,
      error: new Error(`beforeTurn must return an object or void; got ${Array.isArray(value) ? "array" : typeof value}`),
    });
    return null;
  }
  const obj = value as Record<string, unknown>;
  if (!("promptPrefix" in obj)) return null;
  const prefix = obj.promptPrefix;
  if (prefix === undefined || prefix === null) return null;
  if (typeof prefix !== "string") {
    logPluginFailure({
      pluginId: p.id,
      hook: "beforeTurn",
      agentId: ctx.agentId,
      roomId: ctx.roomId,
      origin,
      durationMs: Date.now() - startMs,
      error: new Error(`beforeTurn promptPrefix must be a string; got ${typeof prefix}`),
    });
    return null;
  }
  const trimmed = prefix.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function runOneAfterTurn(p: BureauPlugin, ctx: PluginTurnContext, input: PluginAfterTurnInput, origin: TurnOrigin): Promise<void> {
  if (!p.afterTurn) return;

  const start = Date.now();
  let timedOut = false;

  const work = (async () => {
    try {
      await p.afterTurn!(ctx, input);
    } catch (err) {
      if (!timedOut) {
        logPluginFailure({
          pluginId: p.id,
          hook: "afterTurn",
          agentId: ctx.agentId,
          roomId: ctx.roomId,
          origin,
          durationMs: Date.now() - start,
          error: err,
        });
      }
    }
  })();

  const winner = await Promise.race([work.then(() => "ok" as const), new Promise<"timeout">((res) => setTimeout(() => res("timeout"), AFTER_TURN_TIMEOUT_MS))]);

  if (winner === "timeout") {
    timedOut = true;
    logPluginFailure({
      pluginId: p.id,
      hook: "afterTurn",
      agentId: ctx.agentId,
      roomId: ctx.roomId,
      origin,
      durationMs: AFTER_TURN_TIMEOUT_MS,
      error: new Error(`afterTurn timed out after ${AFTER_TURN_TIMEOUT_MS}ms`),
    });
  }
}
