// Interactive agent browser — engine behind POST /api/agents/:id/browser.
//
// One shared Chrome for the office, one BrowserContext per agent, idle teardown.
// Chrome keeps its sandbox (`--no-sandbox` is never passed). Downloads refused.
// URL policy matches preview-url (local/private + allowlist). Live JPEG via CDP.

import type { Browser, BrowserContext, Page } from "playwright-core";
import type { BrowserHumanInput } from "../../shared/wire-client-types.ts";
import { assertAllowedHost, BROWSER_CANDIDATES, findBrowser as defaultFindBrowser } from "../preview-capture.ts";
import { fail, parseBrowserParams, type BrowserFailure, type BrowserResult, type BrowserSuccess, type ParsedParams } from "./params.ts";
import { DeadlineError, LiveViews, stopScreencast, withDeadline, type BrowserFrameListener, type LiveSession } from "./live.ts";
import { NoPageError, performBrowserAction } from "./perform.ts";

export {
  BROWSER_ACTIONS,
  BROWSER_MAX_DIM,
  BROWSER_MIN_DIM,
  describeShot,
  MAX_TEXT_CHARS,
  parseBrowserParams,
  type BrowserAction,
  type BrowserErrorCode,
  type BrowserFailure,
  type BrowserResult,
  type BrowserSuccess,
} from "./params.ts";
export type { BrowserFrame, BrowserFrameListener } from "./live.ts";

export const BROWSER_IDLE_MS = 5 * 60 * 1000;
export const BROWSER_ACTION_DEADLINE_MS = 30_000;
const BACKSTOP_MARGIN_MS = 5_000;

export interface BrowserSessionDeps {
  findBrowser?: () => string | null;
  launch?: (executablePath: string) => Promise<Browser>;
  idleMs?: number;
  actionMs?: number;
  backstopMs?: number;
  publicHostAllowlist?: string[];
  lookupFn?: (hostname: string) => Promise<Array<{ address: string; family: number }>>;
}

const LAUNCH_ARGS = [
  "--disable-background-networking",
  "--disable-component-update",
  "--disable-sync",
  "--disable-default-apps",
  "--disable-client-side-phishing-detection",
  "--disable-domain-reliability",
  "--metrics-recording-only",
  "--disable-features=OptimizationHints,MediaRouter,Translate",
];

export function launchOptions(executablePath: string) {
  return { executablePath, headless: true as const, args: LAUNCH_ARGS, handleSIGINT: false as const, handleSIGTERM: false as const, handleSIGHUP: false as const };
}

async function defaultLaunch(executablePath: string): Promise<Browser> {
  const { chromium } = await import("playwright-core");
  return chromium.launch(launchOptions(executablePath));
}

interface AgentSession extends LiveSession {
  context: BrowserContext;
  timer: ReturnType<typeof setTimeout> | null;
}

export class BrowserPool {
  private browser: Browser | null = null;
  private launching: Promise<Browser> | null = null;
  private readonly sessions = new Map<string, AgentSession>();
  private readonly queues = new Map<string, Promise<unknown>>();
  private lifecycleChain: Promise<unknown> = Promise.resolve();
  private readonly findBrowser: () => string | null;
  private readonly launch: (executablePath: string) => Promise<Browser>;
  private readonly idleMs: number;
  private readonly actionMs: number;
  private readonly backstopMs: number;
  private publicHostAllowlist: string[];
  private readonly lookupFn?: BrowserSessionDeps["lookupFn"];
  private readonly live = new LiveViews();

  constructor(deps: BrowserSessionDeps = {}) {
    this.findBrowser = deps.findBrowser ?? defaultFindBrowser;
    this.launch = deps.launch ?? defaultLaunch;
    this.idleMs = deps.idleMs ?? BROWSER_IDLE_MS;
    this.actionMs = deps.actionMs ?? BROWSER_ACTION_DEADLINE_MS;
    this.backstopMs = deps.backstopMs ?? this.actionMs + BACKSTOP_MARGIN_MS;
    this.publicHostAllowlist = deps.publicHostAllowlist ?? [];
    this.lookupFn = deps.lookupFn;
  }

  setPublicHostAllowlist(hosts: string[]) {
    this.publicHostAllowlist = hosts;
  }

  activeAgents(): string[] {
    return [...this.sessions.keys()];
  }

  peek(agentId: string): { active: true; url: string } | { active: false } {
    const session = this.sessions.get(agentId);
    if (!session || session.page.isClosed() || !session.opened) return { active: false };
    const url = session.page.url();
    if (!url || url === "about:blank") return { active: false };
    return { active: true, url };
  }

  status(agentId: string): { available: boolean; url: string; title: string } {
    const session = this.sessions.get(agentId);
    if (!session || session.page.isClosed() || !session.opened) return { available: false, url: "", title: "" };
    return { available: true, url: session.page.url(), title: session.title };
  }

  watch(agentId: string, listener: BrowserFrameListener, bounds: { maxWidth?: number; maxHeight?: number } = {}): () => void {
    return this.live.watch(agentId, listener, bounds, () => this.sessions.get(agentId));
  }

  async selection(agentId: string): Promise<{ text: string; truncated: boolean }> {
    return this.serialize(agentId, async () => {
      const session = this.sessions.get(agentId);
      if (!session || session.page.isClosed() || !session.opened) throw new NoPageError();
      return this.live.selection(session.page, this.backstopMs);
    });
  }

  async humanInput(agentId: string, input: Exclude<BrowserHumanInput, { kind: "selection" }>): Promise<boolean> {
    const session = this.sessions.get(agentId);
    if (!session || !session.screencast || session.page.isClosed()) return false;
    this.touch(agentId, session);
    await this.live.humanInput(session.screencast, input);
    return true;
  }

  private serialize<T>(agentId: string, work: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(agentId) ?? Promise.resolve();
    const result = prev.then(work, work);
    const tail = result.then(
      () => {},
      () => {},
    );
    this.queues.set(agentId, tail);
    void tail.then(() => {
      if (this.queues.get(agentId) === tail) this.queues.delete(agentId);
    });
    return result;
  }

  private lifecycle<T>(work: () => Promise<T>): Promise<T> {
    const result = this.lifecycleChain.then(work, work);
    this.lifecycleChain = result.then(
      () => {},
      () => {},
    );
    return result;
  }

  private detachBrowser(): Browser | null {
    const browser = this.browser;
    this.browser = null;
    return browser;
  }

  private touch(agentId: string, session: AgentSession): void {
    if (session.timer) clearTimeout(session.timer);
    session.timer = setTimeout(() => {
      void this.close(agentId);
    }, this.idleMs);
    session.timer.unref?.();
  }

  private async ensureBrowser(): Promise<Browser | BrowserFailure> {
    if (this.browser?.isConnected()) return this.browser;
    if (this.browser) this.dropAllSessions();
    if (!this.launching) {
      const executable = this.findBrowser();
      if (!executable) {
        return fail(500, "no_browser", `no Chrome-family browser found (tried ${BROWSER_CANDIDATES.join(", ")}); install one or set BUREAU_PREVIEW_BROWSER`);
      }
      this.launching = this.launch(executable).finally(() => {
        this.launching = null;
      });
    }
    try {
      this.browser = await this.launching;
      return this.browser;
    } catch (err) {
      return fail(500, "launch_failed", `could not start the browser: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private dropAllSessions(): void {
    for (const [agentId, session] of this.sessions) {
      if (session.timer) clearTimeout(session.timer);
      void stopScreencast(session);
      this.live.notify(agentId, null);
    }
    this.sessions.clear();
    this.browser = null;
  }

  private async ensureSession(agentId: string, viewport: { width: number; height: number }): Promise<AgentSession | BrowserFailure> {
    const live = this.sessions.get(agentId);
    if (live && !live.page.isClosed() && this.browser?.isConnected()) {
      this.touch(agentId, live);
      return live;
    }
    return this.lifecycle(() => this.createSession(agentId, viewport));
  }

  private async createSession(agentId: string, viewport: { width: number; height: number }): Promise<AgentSession | BrowserFailure> {
    const browser = await this.ensureBrowser();
    if ("ok" in browser) return browser;
    const existing = this.sessions.get(agentId);
    if (existing && !existing.page.isClosed()) {
      this.touch(agentId, existing);
      return existing;
    }
    if (existing) {
      await stopScreencast(existing);
      this.sessions.delete(agentId);
      this.live.notify(agentId, null);
      await existing.context.close().catch(() => {});
    }
    const context = await browser.newContext({ viewport, acceptDownloads: false });
    const page = await context.newPage();
    const session: AgentSession = {
      context,
      page,
      opened: false,
      timer: null,
      screencast: null,
      screencastStarting: null,
      captureSize: null,
      lastFrame: null,
      title: "",
    };
    this.sessions.set(agentId, session);
    context.on("page", (fresh: Page) => {
      void this.serialize(agentId, async () => {
        const current = this.sessions.get(agentId);
        if (!current || current.context !== context) return;
        if (fresh === current.page || fresh.isClosed()) return;
        const previous = current.page;
        await stopScreencast(current);
        current.page = fresh;
        current.opened = true;
        await previous.close().catch(() => {});
        void this.live.ensureScreencast(agentId, current, () => this.sessions.get(agentId));
      });
    });
    this.touch(agentId, session);
    void this.live.ensureScreencast(agentId, session, () => this.sessions.get(agentId));
    return session;
  }

  async close(agentId: string): Promise<void> {
    await this.serialize(agentId, () => this.closeNow(agentId));
  }

  private async closeNow(agentId: string): Promise<void> {
    const session = this.sessions.get(agentId);
    if (!session) return;
    if (session.timer) clearTimeout(session.timer);
    const orphan = await this.lifecycle(async () => {
      if (this.sessions.get(agentId) !== session) return null;
      this.sessions.delete(agentId);
      return this.sessions.size === 0 ? this.detachBrowser() : null;
    });
    await stopScreencast(session);
    this.live.notify(agentId, null);
    await session.context.close().catch(() => {});
    if (orphan) await orphan.close().catch(() => {});
  }

  async shutdown(): Promise<void> {
    for (const agentId of [...this.sessions.keys()]) await this.close(agentId);
    const orphan = await this.lifecycle(async () => this.detachBrowser());
    if (orphan) await orphan.close().catch(() => {});
  }

  async run(agentId: string, body: unknown): Promise<BrowserResult> {
    const parsed = parseBrowserParams(body);
    if (!parsed.ok) return parsed;
    if (parsed.action === "goto" && parsed.url) {
      const policy = await assertAllowedHost(parsed.url, {
        publicHostAllowlist: this.publicHostAllowlist,
        lookupFn: this.lookupFn,
      });
      if (policy && !policy.ok) return fail(400, "invalid_request", policy.error);
    }
    return this.serialize(agentId, () => this.runNow(agentId, parsed));
  }

  private async runNow(agentId: string, params: ParsedParams): Promise<BrowserResult> {
    if (params.action === "close") {
      await this.closeNow(agentId);
      return { ok: true, url: "", title: "", closed: true };
    }
    const session = await this.ensureSession(agentId, params.viewport);
    if ("ok" in session) return session;
    if (params.action !== "goto" && !session.opened) {
      return fail(400, "no_page", "no page is open; call the goto action first");
    }
    let work: Promise<BrowserSuccess> | undefined;
    try {
      work = performBrowserAction(session.page, params, this.actionMs, () => {
        session.opened = true;
      });
      const result = await withDeadline(work, this.backstopMs);
      session.title = result.title;
      if (this.live.hasViewers(agentId)) void this.live.ensureScreencast(agentId, session, () => this.sessions.get(agentId));
      this.live.notify(agentId, null);
      return result;
    } catch (err) {
      if (err instanceof DeadlineError) {
        await this.closeNow(agentId);
        if (work) await work.catch(() => {});
        return fail(500, "action_timeout", `the browser did not finish ${params.action} in ${this.backstopMs}ms`);
      }
      if (err instanceof NoPageError) return fail(400, "no_page", err.message);
      return fail(500, "action_failed", err instanceof Error ? err.message.split("\n")[0]! : String(err));
    }
  }
}

export const browserPool = new BrowserPool();
