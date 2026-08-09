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

import { validateCwd } from "../agents/session/paths.ts";
import type { AuthResult } from "../auth/auth-middleware.ts";
import { broadcast } from "../ws/broadcast.ts";
import { appRegistry, type AppRegistry } from "../apps/registry.ts";
import { appSupervisor, APP_LOG_LINES_DEFAULT, UNKNOWN_RUNTIME, type AppRuntime } from "../apps/supervisor.ts";
import { announced, appAttributionFor, json, jsonError, JSON_HEADERS, readAppJson, renderAppError, resolveAppsIdentity, visibleApp, visibleApps, type AppsIdentity } from "./app-route-helpers.ts";
import { errMessage } from "../../shared/errors.ts";
import type { AppLogsRes, AppRecord, AppWire } from "../../shared/apps.ts";

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
  // The recovery verbs. Without them the only cure for an app that has come to
  // rest in `failed` is DELETE, which costs it its port and its data directory
  // — a steep price for a crash loop or a source file that has since been
  // fixed. (A mistyped start COMMAND is cured by PATCH instead, which rewrites
  // the unit and restarts what was running.)
  start(name: string): void;
  stop(name: string): void;
  restart(name: string): void;
  logs(name: string, lines: number): string[];
  // The app's public address, or null when this office has no app hostnames.
  publicUrl(record: AppRecord): string | null;
}

export const defaultAppsDeps: AppsDeps = {
  registry: appRegistry,
  states: (names) => appSupervisor.states(names),
  install: (record) => appSupervisor.install(record),
  reinstall: (record) => appSupervisor.reinstall(record),
  teardown: (name) => appSupervisor.teardown(name),
  start: (name) => appSupervisor.start(name),
  stop: (name) => appSupervisor.stop(name),
  restart: (name) => appSupervisor.restart(name),
  logs: (name, lines) => appSupervisor.logs(name, lines),
  // App-host arm lands later: no app hostnames yet.
  publicUrl: () => null,
};

export async function handleAppsRequest(req: Request, url: URL, auth?: AuthResult, deps: AppsDeps = defaultAppsDeps): Promise<Response | null> {
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] !== "api" || parts[1] !== "apps") return null;
  if (parts.length > 4) return null;
  // The only sub-resources: the control verbs and the log tail.
  if (parts.length === 4 && !APP_SUBROUTES.has(parts[3]!)) return null;

  const identity = resolveAppsIdentity(req, auth);
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

    // start / stop / restart differ only in the verb. Each answers with the
    // app's FRESH state rather than 204, so the caller learns whether the thing
    // it asked for actually happened without a second round trip. A throw
    // escapes to renderAppError, so nothing is announced — a verb that failed
    // changed nothing to tell anyone about.
    if (parts.length === 4 && req.method === "POST" && parts[3] !== "logs") {
      const record = visibleApp(deps.registry.get(parts[2]!), identity);
      if (!record) return jsonError(404, "not_found", "no app has that name");
      const verb = parts[3] as "start" | "stop" | "restart";
      if (verb === "start") deps.start(record.name);
      else if (verb === "stop") deps.stop(record.name);
      else deps.restart(record.name);
      const wire = wireOf(record, deps.states([record.name]).get(record.name));
      announced(record.name, () => broadcast({ type: "app_updated", app: wire }));
      return json(200, wire);
    }

    if (parts.length === 4 && parts[3] === "logs" && req.method === "GET") {
      const record = visibleApp(deps.registry.get(parts[2]!), identity);
      if (!record) return jsonError(404, "not_found", "no app has that name");
      // Validated rather than clamped silently: `lines=banana` and `lines=-5`
      // are caller mistakes, and quietly answering with the default hides the
      // bug in whatever built the URL. A number that is merely too big IS
      // clamped (inside the supervisor, where the ceiling is defined) — asking
      // for more than we cap at is a reasonable thing to want, unlike asking
      // for nonsense. isSafeInteger as well as the digit grammar: a long enough
      // digit string passes the regex and converts to something unusable.
      const raw = url.searchParams.get("lines");
      let lines = APP_LOG_LINES_DEFAULT;
      if (raw !== null) {
        if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) < 1) {
          return jsonError(400, "invalid_request", "lines must be a positive whole number");
        }
        lines = Number(raw);
      }
      const body: AppLogsRes = { name: record.name, lines: deps.logs(record.name, lines) };
      return json(200, body);
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
  const body = await readAppJson(req);
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

  const attribution = appAttributionFor(identity);
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
  const body = await readAppJson(req);
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

const APP_SUBROUTES: ReadonlySet<string> = new Set(["start", "stop", "restart", "logs"]);
