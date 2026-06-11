import { addCCMarketplace, CCPluginError, disableCCPlugin, enableCCPlugin, getCCPluginsState, installCCPlugin, removeCCMarketplace, uninstallCCPlugin, updateCCPlugin } from "../plugins/cc-plugins.ts";

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function errorResponse(err: unknown): Response {
  // CCPluginError carries operator-facing CLI failure text; anything else is
  // unexpected and shouldn't leak internals beyond the message.
  const message = err instanceof Error ? err.message : String(err);
  return json({ error: message }, err instanceof CCPluginError ? 400 : 500);
}

/**
 * Handle every /plugins request (Claude Code plugin management — see
 * server/plugins/cc-plugins.ts). Returns null for any non-plugins URL so the
 * caller can fall through to the next router. Auth is enforced upstream in
 * server/index.ts alongside the tasks/cronjobs APIs.
 */
export async function handlePluginsRequest(req: Request, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith("/plugins")) return null;

  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  const parts = url.pathname.split("/").filter(Boolean); // ["plugins", action?, subaction?]
  const action = parts[1];
  const subaction = parts[2];

  // GET /plugins — full snapshot (installed + available + marketplaces).
  // ?refresh=1 bypasses the cache (e.g. after hand-editing via the terminal).
  if (req.method === "GET" && !action) {
    try {
      return json(await getCCPluginsState({ refresh: url.searchParams.get("refresh") === "1" }));
    } catch (err) {
      return errorResponse(err);
    }
  }

  if (req.method !== "POST") {
    return json({ error: "not found" }, 404);
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }
  const plugin = typeof body.plugin === "string" ? body.plugin.trim() : "";

  try {
    // POST /plugins/marketplace/{add,remove}
    if (action === "marketplace") {
      if (subaction === "add") {
        const source = typeof body.source === "string" ? body.source.trim() : "";
        if (!source) return json({ error: "source required (owner/repo, URL, or path)" }, 400);
        return json(await addCCMarketplace(source));
      }
      if (subaction === "remove") {
        const name = typeof body.name === "string" ? body.name.trim() : "";
        if (!name) return json({ error: "name required" }, 400);
        return json(await removeCCMarketplace(name));
      }
      return json({ error: "not found" }, 404);
    }

    // POST /plugins/{install,remove,enable,disable,update} — body: { plugin, scope? }
    if (!plugin) return json({ error: "plugin required (name or name@marketplace)" }, 400);
    switch (action) {
      case "install":
        return json(await installCCPlugin(plugin, typeof body.scope === "string" ? body.scope : undefined));
      case "remove":
        return json(await uninstallCCPlugin(plugin));
      case "enable":
        return json(await enableCCPlugin(plugin));
      case "disable":
        return json(await disableCCPlugin(plugin));
      case "update":
        return json(await updateCCPlugin(plugin));
      default:
        return json({ error: "not found" }, 404);
    }
  } catch (err) {
    return errorResponse(err);
  }
}
