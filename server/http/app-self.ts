/**
 * POST /api/app/message — the loop closed: an app messaging the agent that
 * built it. Besides paging its owner (server/pager/routes.ts), the only route
 * an app token reaches, and the only app route whose caller is the app rather
 * than its owner.
 *
 * NOTHING ABOUT THE MESSAGE IS THE CALLER'S TO CHOOSE except the text. Which
 * app is speaking comes from the token, who hears it comes from the registry,
 * and how it is labelled comes from the app's registered name. A body field for
 * any of those would be a field to lie in — which is why the path carries no
 * app name and the body carries no recipient.
 *
 * Separate from /api/apps deliberately: everything there is the owner managing
 * their apps, and this is an app speaking for itself. Splitting them keeps the
 * app-token surface to exactly one route that can be read in one sitting.
 */

import { readBearerToken } from "../agents/tokens.ts";
import { appRegistry, type AppRegistry } from "../apps/registry.ts";
import { resolveAppToken } from "../apps/tokens.ts";
import { appMessageLimiter, APP_MESSAGE_MAX_CHARS, type AppMessageLimiter } from "../apps/message-limits.ts";
import { json, jsonError, readAppJson, renderAppError } from "./app-route-helpers.ts";
import { defaultAppsDeps } from "./apps-deps.ts";
import type { AppsDeps } from "./apps-seam.ts";

export interface AppSelfDeps {
  registry: AppRegistry;
  limiter: AppMessageLimiter;
  sendAsApp: AppsDeps["sendAsApp"];
  // Resolve a raw bearer token to the app it belongs to, or null.
  resolveToken(raw: string): { appName: string } | null;
}

export async function handleAppSelfRequest(req: Request, url: URL, deps?: AppSelfDeps): Promise<Response | null> {
  if (url.pathname !== "/api/app/message") return null;
  if (req.method !== "POST") return jsonError(405, "method_not_allowed", "POST only");
  const d = deps ?? defaultAppSelfDeps();

  const raw = readBearerToken(req);
  if (!raw) return jsonError(401, "unauthenticated", "an app token is required");
  const identity = d.resolveToken(raw);
  if (!identity) return jsonError(401, "unauthenticated", "missing or invalid app token");
  const appName = identity.appName;

  const body = await readAppJson(req);
  if (typeof body?.text !== "string" || body.text.trim() === "") {
    // trim, not length: a whitespace-only message wakes an agent and burns
    // model tokens on nothing, which is precisely the shape of an unattended
    // caller's bug.
    return jsonError(400, "invalid_text", "text is required");
  }
  if (body.text.length > APP_MESSAGE_MAX_CHARS) {
    return jsonError(400, "text_too_long", `text must be at most ${APP_MESSAGE_MAX_CHARS} characters`);
  }

  // THE BURST SLOT IS TAKEN HERE, before this handler's registry read —
  // deliberately earlier than the delivery attempt. Everything below this line
  // costs bureau something, and a caller that hammers a request which always
  // fails would otherwise pay nothing for it. So a syntactically valid request
  // spends a burst slot whatever its outcome, while the DAILY budget — the one
  // that stands for model spend — is spent at the bottom, only on a delivery
  // the receiver accepted.
  const limit = d.limiter.takeBurst(appName);
  if (!limit.ok) {
    return json(429, {
      error: {
        code: limit.kind === "burst" ? "rate_limited" : "daily_cap_reached",
        message: limit.kind === "burst" ? `too many messages: retry in ${limit.retryAfterSec}s` : `daily message limit reached: retry in ${limit.retryAfterSec}s`,
        // Machine-readable alongside the sentence, so a caller can back off
        // without parsing prose.
        retryAfterSec: limit.retryAfterSec,
      },
    });
  }

  try {
    // Token resolution already refused a token whose app is gone, so this is
    // the narrow race where the app was deleted between the two.
    const record = d.registry.get(appName);
    if (!record) return jsonError(404, "not_found", "this app is no longer registered");
    // Apps registered by a PERSON have no agent attached. Nothing to do about
    // it from here: naming a different target would be exactly the
    // body-supplied recipient this route refuses to have.
    if (!record.createdByAgentId) {
      return jsonError(409, "no_target", "this app was not registered by an agent, so there is no agent to message");
    }
    const sent = d.sendAsApp(appName, record.createdByAgentId, body.text);
    if (!sent.ok) {
      // The agent that built the app is gone. Reported as its own code with an
      // answer to "so what do I do", because the raw delivery error ("agent not
      // found") reads like a bad parameter — and there is no parameter.
      if (sent.status === 404) {
        return jsonError(404, "target_gone", "the agent that registered this app no longer exists, so there is nobody to message");
      }
      return jsonError(sent.status, sent.code, sent.message);
    }
    // ACCEPTED, so the day's budget moves. A stopped, missing or full receiver
    // never reaches this line: it woke nobody, so it costs the app nothing but
    // its burst slot.
    d.limiter.commitDaily(appName);
    return json(200, { messageId: sent.messageId ?? "", ...(sent.queued === undefined ? {} : { queued: sent.queued }) });
  } catch (err) {
    return renderAppError(err);
  }
}

function defaultAppSelfDeps(): AppSelfDeps {
  return {
    registry: appRegistry,
    limiter: appMessageLimiter,
    sendAsApp: defaultAppsDeps.sendAsApp,
    resolveToken: (raw) => resolveAppToken(raw),
  };
}
