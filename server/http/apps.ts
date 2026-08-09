/**
 * /api/apps — the agent-facing app registry. See docs/features/agent-apps.md.
 *
 *   GET    /api/apps            — list the caller-visible apps.
 *   GET    /api/apps/:name      — one app.
 *   POST   /api/apps            — register an app (the agent already built it).
 *   PATCH  /api/apps/:name      — fix command/cwd/description without burning the name.
 *   DELETE /api/apps/:name      — tear the app down and free its name and port.
 *
 * The verb is REGISTER, not create: the agent already built the app; bureau is
 * being handed something that exists, and answers with the port it allocated
 * and the data directory it created.
 *
 * TWO COLLABORATORS, AND THE ORDER BETWEEN THEM IS THE INTERESTING PART. The
 * registry owns the name, the port and the record; the supervisor owns the
 * unit that runs it. Registration goes registry-then-supervisor and deletion
 * goes supervisor-then-registry, and neither order is arbitrary:
 *
 *   - REGISTER commits to the registry FIRST, and a failed install does NOT
 *     undo it. An app whose unit did not install is a registered app that
 *     start/update can still fix, while undoing the record would also throw
 *     away its data directory — so 201 plus `startError` is the truthful
 *     answer, and a 500 would invite a retry of something that already
 *     happened.
 *   - DELETE tears the unit down FIRST because removing the record is the
 *     point of no return in the other direction: it frees the name and the
 *     port, and doing that while the process is still alive leaves it holding
 *     a port under a name the registry has forgotten.
 *
 * [ownership] userId/username/createdBy come from the caller's IDENTITY (agent
 * bearer token or browser session), never the body — the app belongs to the
 * registering agent's MANAGER, so that it survives the agent. A body-supplied
 * owner would let any caller register an app onto someone else.
 *
 * [addressing] The path parameter is a NAME, not an id. A name is unique
 * across LIVE apps and never changes while one exists, so it is already the
 * key. The name reaches the filesystem, so it is validated at registration and
 * a lookup is an exact match against the registry: an unregistered `../x`
 * matches nothing and 404s like any other unknown name.
 */

import * as AgentManager from "../agent-manager.ts";
import { readBearerToken, resolveAgentToken } from "../agents/tokens.ts";
import { validateCwd } from "../agents/session/paths.ts";
import type { AuthResult } from "../auth/auth-middleware.ts";
import { getUserById } from "../users.ts";
import { broadcast } from "../ws/broadcast.ts";
import { appRegistry, AppRegistryError, type AppRegistry } from "../apps/registry.ts";
import { errMessage } from "../../shared/errors.ts";
import type { AppErrorCode, AppRecord, AppState, AppWire } from "../../shared/apps.ts";

const JSON_HEADERS = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

// Runtime the supervisor reports for a set of apps. Until the supervisor seam
// is wired, every app is honestly `unknown` — there is no unit to ask about.
export interface AppRuntime {
  state: AppState;
  restartCount: number;
  startError?: string;
}
export const UNKNOWN_RUNTIME: AppRuntime = { state: "unknown", restartCount: 0 };

// Who is calling, reduced to what the app routes need. Loopback is the box
// owner at a shell — full visibility, like an office owner, but with no user
// to own new registrations.
type AppsIdentity = { scope: "agent"; agentId: string; userId: string | null } | { scope: "user"; userId: string; username: string; role: "owner" | "member" } | { scope: "loopback" };

export interface AppsDeps {
  registry: AppRegistry;
  // Runtime state for a SET of apps: one lookup for a whole list, never one
  // per app. A name the supervisor cannot speak for is simply absent.
  states(names: readonly string[]): Map<string, AppRuntime>;
  // Write the unit and start the app. Throws only when the unit could not be
  // INSTALLED; an app that installs and then fails to run is a state, not an
  // error (see the register handler).
  install(record: AppRecord): void;
  // Regenerate the app's unit from a changed record, preserving whether it was
  // running. Throws when the machine could not be brought in line.
  reinstall(record: AppRecord): void;
  // Stop the app and remove everything bureau generated for it. Throws if the
  // app survived, which is what keeps a failed teardown from freeing the name.
  teardown(name: string): void;
  // The app's public address, or null when this office has no app hostnames.
  publicUrl(record: AppRecord): string | null;
}

// The supervisor seam. This slice registers and persists; the systemd
// supervisor lands next and replaces these no-ops, at which point registered
// apps actually run.
export const defaultAppsDeps: AppsDeps = {
  registry: appRegistry,
  states: (names) => new Map(names.map((n) => [n, UNKNOWN_RUNTIME])),
  install: () => {},
  reinstall: () => {},
  teardown: () => {},
  // App-host arm lands later: no app hostnames yet.
  publicUrl: () => null,
};

// Registry refusals -> HTTP. A 400 is "your request is wrong", a 409 is "the
// world says no", a 500 is "we failed". Kept as one exhaustive table so a new
// code cannot quietly default to 500.
const STATUS_BY_CODE: Record<AppErrorCode, number> = {
  invalid_name: 400,
  reserved_name: 400,
  invalid_command: 400,
  invalid_cwd: 400,
  invalid_description: 400,
  name_taken: 409,
  origin_retired: 409,
  no_label_available: 409,
  app_limit_reached: 409,
  no_port_available: 409,
  registry_corrupt: 500,
  persist_failed: 500,
  supervisor_failed: 500,
};

export async function handleAppsRequest(req: Request, url: URL, auth?: AuthResult, deps: AppsDeps = defaultAppsDeps): Promise<Response | null> {
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] !== "api" || parts[1] !== "apps") return null;
  if (parts.length > 3) return null;

  const identity = resolveIdentity(req, auth);
  if (identity instanceof Response) return identity;

  // The ONE place a record becomes wire. `state` and `restartCount` are
  // derived from the supervisor at read time and never stored — a persisted
  // "running" would be a lie the moment the box reboots.
  const wireOf = (record: AppRecord, runtime: AppRuntime | undefined): AppWire => {
    const { state, restartCount, startError } = runtime ?? UNKNOWN_RUNTIME;
    const publicUrl = deps.publicUrl(record);
    return {
      ...record,
      state,
      restartCount,
      ...(startError ? { startError } : {}),
      // `!== null`, not truthiness: the rule is present-iff-there-is-a-URL,
      // and an empty string would be a URL-shaped answer meaning "none".
      ...(publicUrl !== null ? { url: publicUrl } : {}),
    };
  };

  try {
    if (parts.length === 2 && req.method === "GET") {
      const visible = visibleApps(deps.registry.list(), identity);
      // ONE state lookup for the whole list. A per-app lookup would be a
      // subprocess per app per render, and the Apps tab polls.
      const runtimes = deps.states(visible.map((a) => a.name));
      return json(200, { apps: visible.map((a) => wireOf(a, runtimes.get(a.name))) });
    }

    if (parts.length === 3 && req.method === "GET") {
      const record = visibleApp(deps.registry.get(parts[2]!), identity);
      if (!record) return jsonError(404, "not_found", "no app has that name");
      return json(200, wireOf(record, deps.states([record.name]).get(record.name)));
    }

    if (parts.length === 2 && req.method === "POST") {
      return registerApp(req, identity, deps, wireOf);
    }

    if (parts.length === 3 && req.method === "PATCH") {
      return updateApp(req, parts[2]!, identity, deps, wireOf);
    }

    if (parts.length === 3 && req.method === "DELETE") {
      const record = visibleApp(deps.registry.get(parts[2]!), identity);
      if (!record) return jsonError(404, "not_found", "no app has that name");
      // Teardown FIRST: throws if the app survived, and the record below is
      // then never removed — its name and port stay spoken for, and a retried
      // DELETE can finish the job.
      deps.teardown(record.name);
      if (!deps.registry.remove(record.name)) return jsonError(404, "not_found", "no app has that name");
      // AFTER the removal committed, from the record read before teardown.
      announced(record.name, () => broadcast({ type: "app_removed", name: record.name }));
      return new Response(null, { status: 204, headers: JSON_HEADERS });
    }
  } catch (err) {
    return renderAppError(err);
  }

  return null;
}

async function registerApp(req: Request, identity: AppsIdentity, deps: AppsDeps, wireOf: (r: AppRecord, rt: AppRuntime | undefined) => AppWire): Promise<Response> {
  const body = await readJson(req);
  if (typeof body?.name !== "string") return jsonError(400, "invalid_name", "name is required");
  if (typeof body.command !== "string") return jsonError(400, "invalid_command", "command is required");
  if (typeof body.cwd !== "string" || body.cwd.trim() === "") return jsonError(400, "invalid_cwd", "cwd is required");
  if (body.description !== undefined && typeof body.description !== "string") return jsonError(400, "invalid_description", "description must be a string");

  // Resolved here rather than in the registry so `~/` expands the same way it
  // does for an agent's own cwd, and so the stored path is absolute.
  let cwd: string;
  try {
    cwd = validateCwd(body.cwd);
  } catch (err) {
    return jsonError(400, "invalid_cwd", errMessage(err));
  }

  const attribution = attributionFor(identity);
  try {
    const record = deps.registry.register({
      name: body.name,
      command: body.command,
      cwd,
      ...(body.description !== undefined ? { description: body.description } : {}),
      userId: attribution.userId,
      username: attribution.username,
      createdBy: attribution.createdBy,
      ...(identity.scope === "agent" ? { createdByAgentId: identity.agentId } : {}),
    });
    // THE RECORD IS COMMITTED, SO THE ANSWER IS 201 — whatever the supervisor
    // then does. A 500 here would describe a resource that really was created,
    // and the natural response to a 500 is a retry, which can only ever be
    // told the name is taken. So a failure to install or start is reported
    // through `state` and `startError`, not through the status code.
    try {
      deps.install(record);
    } catch (err) {
      // EVERY error, not just AppRegistryError: past this line the app
      // exists, so nothing that happens can make the answer a failure.
      console.error(`[apps] "${record.name}" registered but not running:`, err);
    }
    // ONE wire object: announced and returned, so the office and the caller
    // are told the same thing by construction. Built after install, so its
    // state reflects whether the app actually came up.
    const wire = wireOf(record, deps.states([record.name]).get(record.name));
    announced(record.name, () => broadcast({ type: "app_updated", app: wire }));
    return json(201, wire);
  } catch (err) {
    return renderAppError(err);
  }
}

async function updateApp(req: Request, name: string, identity: AppsIdentity, deps: AppsDeps, wireOf: (r: AppRecord, rt: AppRuntime | undefined) => AppWire): Promise<Response> {
  const body = await readJson(req);
  if (!body) return jsonError(400, "invalid_request", "invalid JSON body");
  const before = visibleApp(deps.registry.get(name), identity);
  if (!before) return jsonError(404, "not_found", "no app has that name");

  // The immutable fields. PRESENCE is what triggers the check, not type:
  // testing `typeof body.name === "string"` first would let `{name: 7}` slip
  // past as "not a rename" and be silently ignored, which is the same lie as
  // accepting one. Present is then tolerated in exactly one case: the value
  // the app already has — reading an app and PATCHing the object back with one
  // field edited is the obvious way to use this route.
  if (Object.hasOwn(body, "name") && body.name !== before.name) {
    return jsonError(400, "invalid_request", "an app's name cannot be changed: it is the address people bookmark. To use a different name, delete the app and register it again");
  }
  if (Object.hasOwn(body, "port") && body.port !== before.port) {
    return jsonError(400, "invalid_request", "an app's port cannot be changed: bureau allocates it at registration and it stays with the app for its whole life");
  }
  if (body.command !== undefined && typeof body.command !== "string") return jsonError(400, "invalid_command", "command must be a string");
  if (body.cwd !== undefined && (typeof body.cwd !== "string" || body.cwd.trim() === "")) return jsonError(400, "invalid_cwd", "cwd must be a non-empty string");
  if (body.description !== undefined && body.description !== null && typeof body.description !== "string") {
    return jsonError(400, "invalid_description", "description must be a string, or null to remove it");
  }
  // An empty patch is a caller mistake, not a no-op: answering 200 to a
  // request that asked for nothing hides whatever built it.
  if (body.command === undefined && body.cwd === undefined && body.description === undefined) {
    return jsonError(400, "invalid_request", "nothing to update: send at least one of command, cwd, description");
  }

  let cwd: string | undefined;
  if (body.cwd !== undefined) {
    try {
      cwd = validateCwd(body.cwd);
    } catch (err) {
      return jsonError(400, "invalid_cwd", errMessage(err));
    }
  }

  const after = deps.registry.update(before.name, {
    ...(body.command !== undefined ? { command: body.command } : {}),
    ...(cwd !== undefined ? { cwd } : {}),
    ...(body.description !== undefined ? { description: body.description } : {}),
  });
  // Deleted between the read and the write: nothing was updated, so this is
  // the same answer an unknown name gets.
  if (!after) return jsonError(404, "not_found", "no app has that name");

  // The machine only hears about changes it can act on. A description edit
  // leaves systemd alone entirely, so editing an app's blurb never bounces a
  // running process.
  if (after.command !== before.command || after.cwd !== before.cwd) {
    try {
      deps.reinstall(after);
    } catch (err) {
      // 200 EVEN SO, for the same reason register answers 201 when the
      // supervisor fails: the record has already changed, and a status that
      // says otherwise would describe a resource that really was updated. The
      // failure rides back on the body as the app's truthful state.
      console.error(`[apps] "${after.name}" updated but its unit was not brought in line:`, err);
    }
  }
  const wire = wireOf(after, deps.states([after.name]).get(after.name));
  announced(after.name, () => broadcast({ type: "app_updated", app: wire }));
  return json(200, wire);
}

// --- identity ----------------------------------------------------------------

function resolveIdentity(req: Request, auth?: AuthResult): AppsIdentity | Response {
  const rawBearer = readBearerToken(req);
  const bearer = resolveAgentToken(rawBearer);
  if (rawBearer && !bearer) return jsonError(401, "unauthenticated", "missing or invalid bearer token");
  if (bearer) return { scope: "agent", agentId: bearer.agentId, userId: bearer.userId };
  if (auth?.kind === "ok") return { scope: "user", userId: auth.session.userId, username: auth.session.username, role: auth.session.role };
  if (auth?.kind === "loopback") return { scope: "loopback" };
  return jsonError(401, "unauthenticated", "authentication required");
}

// Token-derived attribution, shared with the task board's convention:
// createdBy is the caller's display identity (agent name, or the human's
// name), the owner is the token's user — for an agent, its manager.
function attributionFor(identity: AppsIdentity): { userId: string | null; username: string | null; createdBy: string } {
  switch (identity.scope) {
    case "agent": {
      const display = AgentManager.getAgentDisplay(identity.agentId);
      const owner = identity.userId ? getUserById(identity.userId) : null;
      return { userId: identity.userId, username: owner?.name ?? null, createdBy: display?.name ?? identity.agentId };
    }
    case "user":
      return { userId: identity.userId, username: identity.username, createdBy: identity.username };
    case "loopback":
      return { userId: null, username: null, createdBy: "local" };
  }
}

// Office owners (and the box owner at a loopback shell) see every app;
// everyone else sees the apps their user owns. Mirrors the cronjob rule.
//
// A browser session carries its own role, so it is read from the session
// rather than looked up again. An agent's role is its MANAGER's, which only
// the users store knows — an agent with no manager is nobody's owner.
function seesAll(identity: AppsIdentity): boolean {
  switch (identity.scope) {
    case "loopback":
      return true;
    case "user":
      return identity.role === "owner";
    case "agent":
      return identity.userId !== null && getUserById(identity.userId)?.role === "owner";
  }
}

function visibleApps(all: AppRecord[], identity: AppsIdentity): AppRecord[] {
  if (seesAll(identity)) return all;
  const userId = identity.scope === "loopback" ? null : identity.userId;
  return all.filter((a) => a.userId !== null && a.userId === userId);
}

function visibleApp(record: AppRecord | null, identity: AppsIdentity): AppRecord | null {
  if (!record) return null;
  return visibleApps([record], identity).length > 0 ? record : null;
}

// --- plumbing ----------------------------------------------------------------

// Announce, and never let the telling of it change what was told. Every
// announce call site sits AFTER its commit point; a throw from the broadcast
// would answer 500 for a register that really did register. The announcement
// is the LAST thing that happens and the least important: a socket that missed
// a frame re-converges on the Apps tab's next fetch, while a lie about whether
// the mutation happened does not heal.
function announced(what: string, send: () => void): void {
  try {
    send();
  } catch (err) {
    console.error(`[apps] "${what}" changed but was not announced:`, err);
  }
}

// A registry error carries the wire code; anything else is a genuine surprise
// and is re-thrown for the router to log and answer 500.
function renderAppError(err: unknown): Response {
  if (err instanceof AppRegistryError) {
    return jsonError(STATUS_BY_CODE[err.code], err.code, err.message);
  }
  throw err;
}

async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function jsonError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), { status, headers: JSON_HEADERS });
}
