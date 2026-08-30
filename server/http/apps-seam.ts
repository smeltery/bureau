// The seam the /api/apps handlers are written against: everything the routes
// need from the registry, the systemd supervisor, the token store and the rate
// limiter, as one injectable surface. Its own module so the handler file and
// the production wiring can both refer to it without importing each other.

import type { AppRegistry } from "../apps/registry.ts";
import type { AppRuntime } from "../apps/supervisor.ts";
import type { AppMessageLimiter } from "../apps/message-limits.ts";
import type { AppRecord } from "../../shared/apps.ts";
import type { AppPreviewResult } from "../apps/preview.ts";

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
  // Provision the app's token: mint it, persist its hash, and write the
  // plaintext into the environment file its unit reads. Returns whether the app
  // ended up with one. NEVER throws — an app that could not be given a token is
  // an app that runs without one, not a failed registration.
  //
  // The two halves are a PAIR: the hash is worthless without the plaintext (an
  // app that can never authenticate and cannot be repaired), so a failure to
  // write the file revokes the hash again rather than leaving one behind.
  provisionToken(record: AppRecord): boolean;
  // Drop an app's token when the app is deleted. Throws if the hash could not
  // be removed, which fails the delete before the name is freed — a credential
  // outliving the thing it names is worth a retry.
  revokeToken(name: string): void;
  // Deliver a message from `appName` to the agent that built it. The SENDER is
  // built server-side from the app name the token resolved to, so nothing a
  // caller writes can appear as the sender. Never steers: an app must not be
  // able to interrupt a turn in progress.
  sendAsApp(appName: string, targetAgentId: string, text: string): { ok: true; messageId?: string; queued?: boolean } | { ok: false; status: number; code: string; message: string };
  limiter: AppMessageLimiter;
  // The app's public address, or null when this office has no app hostnames.
  publicUrl(record: AppRecord): string | null;
  // Capture and cache a screenshot for the Apps tab preview card.
  preview(record: AppRecord): Promise<AppPreviewResult>;
  invalidatePreview(name: string): void;
}
