// One process per durable profile, leased by transports and idle-reaped.
// Environment changes restart only between turns; legacy stores remain in place.

import { statSync } from "node:fs";
import { previousProfileProcess, saveProfileProcess } from "./profiles/process-record.ts";
import { spawn, type ChildProcess } from "node:child_process";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { BUREAU_DIR } from "../../persistence/paths.ts";
import { DEFAULT_OPENCODE_CONFIG } from "./config.ts";
import { type DiscoveredOpenCodeModel } from "./parse.ts";
import { resolveOpenCodeBinary } from "./runtime.ts";
import { processIdentityMatches, readProcessStartTicks } from "./process-identity.ts";
import { environmentRevision, openCodeChildEnvironment } from "./profiles/environment.ts";
import { modelCatalogFor, waitForCatalog } from "./connection/model-catalog.ts";

export const OPENCODE_IDLE_SHUTDOWN_MS = 10 * 60 * 1000;
const USERNAME = "bureau";
const HEALTH_TIMEOUT_MS = 8_000;

interface ServerRecord {
  pid: number;
  port: number;
  password: string;
  startTicks?: string;
}

export interface OpenCodeLease {
  baseUrl: string;
  authHeader: string;
  pid: number;
  release(): void;
  beginTurn(): Promise<void>;
  recoverBeforePrompt(): Promise<void>;
  endTurn(): void;
  markUnresponsive?(): void;
}

export interface OpenCodeSupervisorOptions {
  profileDir?: string;
  binary?: string;
  config?: Record<string, unknown>;
  idleShutdownMs?: number;
  launchEnv?: Record<string, string | undefined>;
}

export class OpenCodeSupervisor {
  private leases = 0;
  private activeTurns = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private record: ServerRecord | null = null;
  private child: ChildProcess | null = null;
  private starting: Promise<void> | null = null;
  private unresponsive = false;
  readonly profileDir: string;
  private readonly binary: string | undefined;
  private readonly config: Record<string, unknown>;
  private readonly idleShutdownMs: number;
  private launchEnv: Record<string, string | undefined>;

  private checkedPreviousProcess = false;
  private runningRevision: string | null = null;

  constructor(options: OpenCodeSupervisorOptions = {}) {
    this.profileDir = options.profileDir ?? join(BUREAU_DIR, "opencode", "profiles", "default");
    this.binary = options.binary;
    this.config = { ...(options.config ?? DEFAULT_OPENCODE_CONFIG), autoupdate: false };
    this.idleShutdownMs = options.idleShutdownMs ?? OPENCODE_IDLE_SHUTDOWN_MS;
    this.launchEnv = options.launchEnv ?? {};
  }

  async acquire(env?: Record<string, string | undefined>): Promise<OpenCodeLease> {
    const requestedEnv = { ...process.env, ...(env ?? this.launchEnv) };
    const revision = this.revisionFor(requestedEnv);
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    await this.ensureServer(requestedEnv);
    this.leases++;
    let released = false;
    let turnActive = false;
    const record = () => {
      if (!this.record || this.runningRevision !== revision) throw new Error("OpenCode environment changed; retry the operation.");
      return this.record;
    };
    return {
      get baseUrl() {
        return `http://127.0.0.1:${record().port}`;
      },
      get authHeader() {
        return `Basic ${btoa(`${USERNAME}:${record().password}`)}`;
      },
      get pid() {
        return record().pid;
      },
      release: () => {
        if (released) return;
        released = true;
        this.leases--;
        this.armIdleReap();
      },
      beginTurn: async () => {
        if (released || turnActive) return;
        await this.validateServerForTurn(false, requestedEnv);
        record();
        if (released) return;
        turnActive = true;
        this.activeTurns++;
        if (this.idleTimer) clearTimeout(this.idleTimer);
        this.idleTimer = null;
      },
      recoverBeforePrompt: async () => {
        if (released || !turnActive) return;
        this.unresponsive = true;
        await this.validateServerForTurn(true, requestedEnv);
      },
      markUnresponsive: () => {
        this.unresponsive = true;
      },
      endTurn: () => {
        if (!turnActive) return;
        turnActive = false;
        this.activeTurns--;
        this.armIdleReap();
      },
    };
  }

  async shutdown(): Promise<void> {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    const child = this.child;
    const record = this.record;
    this.child = null;
    this.record = null;
    if (!child?.pid && !record) return;
    const pid = child?.pid ?? record!.pid;
    if (record?.startTicks && !processIdentityMatches(pid, record.startTicks)) return;
    try {
      process.kill(pid, "SIGTERM");
    } catch {}
    for (let i = 0; i < 40; i++) {
      try {
        process.kill(pid, 0);
      } catch {
        return;
      }
      await Bun.sleep(25);
    }
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }

  private async ensureServer(env: Record<string, string | undefined>): Promise<void> {
    if (this.starting) {
      await this.starting;
      return this.ensureServer(env);
    }
    const record = this.record;
    const healthy = record && this.runningRevision === this.revisionFor(env) && !this.unresponsive && (await this.healthy(record));
    if (healthy && record === this.record && !this.unresponsive) return;
    if (this.starting) {
      await this.starting;
      return this.ensureServer(env);
    }
    if (this.activeTurns > 0) throw new Error("OpenCode server cannot restart while another turn is active.");
    this.starting = this.startServer(env).finally(() => {
      this.starting = null;
    });
    await this.starting;
  }

  private async validateServerForTurn(ownsTurn: boolean, env: Record<string, string | undefined>): Promise<void> {
    const healthy = this.record && this.runningRevision === this.revisionFor(env) && !this.unresponsive && (await this.healthy(this.record));
    if (this.unresponsive || !healthy) {
      if (this.activeTurns > (ownsTurn ? 1 : 0)) throw new Error("OpenCode server health check failed during an active turn.");
      // Before submitting a prompt this turn may own the only active lease.
      if (!this.starting)
        this.starting = this.startServer(env).finally(() => {
          this.starting = null;
        });
      await this.starting;
    }
  }

  private async startServer(env: Record<string, string | undefined>): Promise<void> {
    if (!this.checkedPreviousProcess) {
      this.checkedPreviousProcess = true;
      const previous = previousProfileProcess(this.profileDir);
      if (previous) this.record = { ...previous, port: 0, password: "" };
    }
    await this.shutdown();
    this.launchEnv = env;
    await mkdir(this.profileDir, { recursive: true });
    const configPath = join(this.profileDir, "opencode.json");
    await writeFile(configPath, `${JSON.stringify(this.config)}\n`, { mode: 0o600 });
    await chmod(configPath, 0o600);
    const binary = this.binary ?? resolveOpenCodeBinary({ ...process.env, ...this.launchEnv });
    const password = randomBytes(32).toString("base64url");
    let started: ServerRecord | null = null;
    let lastError = "";
    for (let attempt = 0; attempt < 20; attempt++) {
      const port = 22000 + Math.floor(Math.random() * 1000);
      const child = spawn(binary, ["serve", "--hostname", "127.0.0.1", "--port", String(port)], {
        cwd: this.profileDir,
        detached: true,
        stdio: ["ignore", "ignore", "pipe"],
        env: this.childEnv(password, configPath),
      });
      child.unref();
      let stderr = "";
      child.stderr?.on("data", (chunk) => {
        stderr += String(chunk);
      });
      if (child.pid && (await this.waitHealthy(port, password, child))) {
        started = { pid: child.pid, port, password, startTicks: readProcessStartTicks(child.pid) ?? undefined };
        this.child = child;
        break;
      }
      if (child.pid) {
        try {
          process.kill(child.pid, "SIGTERM");
        } catch {}
      }
      lastError = stderr.trim() || "health check failed";
      if (!/EADDRINUSE|address already in use/i.test(stderr)) break;
    }
    if (!started) {
      throw new Error(`OpenCode server failed to start: ${lastError}`);
    }
    this.record = started;
    try {
      saveProfileProcess(this.profileDir, started.pid, started.startTicks);
    } catch (error) {
      await this.shutdown();
      throw error;
    }
    this.runningRevision = this.revisionFor(env);
    this.unresponsive = false;
  }

  private childEnv(password: string, configPath: string): NodeJS.ProcessEnv {
    // Office authority belongs to the per-turn broker, never to a shared child.
    const filtered = openCodeChildEnvironment(this.launchEnv);
    return {
      ...filtered,
      PATH: this.launchEnv.PATH ?? process.env.PATH ?? "/usr/bin:/bin",
      LANG: "C.UTF-8",
      HOME: join(this.profileDir, "home"),
      XDG_CONFIG_HOME: join(this.profileDir, "config"),
      XDG_DATA_HOME: join(this.profileDir, "data"),
      XDG_STATE_HOME: join(this.profileDir, "state"),
      XDG_CACHE_HOME: join(this.profileDir, "cache"),
      OPENCODE_CONFIG: configPath,
      OPENCODE_DISABLE_AUTOUPDATE: "1",
      OPENCODE_DISABLE_SHARE: "1",
      OPENCODE_SERVER_USERNAME: USERNAME,
      OPENCODE_SERVER_PASSWORD: password,
    };
  }

  private async healthy(record: ServerRecord): Promise<boolean> {
    try {
      process.kill(record.pid, 0);
      const response = await fetch(`http://127.0.0.1:${record.port}/global/health`, {
        headers: { authorization: `Basic ${btoa(`${USERNAME}:${record.password}`)}` },
        signal: AbortSignal.timeout(1_500),
      });
      const body = (await response.json()) as { healthy?: boolean };
      return response.ok && body.healthy === true;
    } catch (error) {
      // A busy server may miss a short health deadline. Reuse it only when
      // its kernel process identity still matches the process we launched.
      return error instanceof Error && error.name === "TimeoutError" && processIdentityMatches(record.pid, record.startTicks);
    }
  }

  private async waitHealthy(port: number, password: string, child: ChildProcess): Promise<boolean> {
    const deadline = Date.now() + HEALTH_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (child.exitCode !== null || !child.pid) return false;
      if (await this.healthy({ pid: child.pid, port, password })) return true;
      await Bun.sleep(50);
    }
    return false;
  }

  private revisionFor(env: Record<string, string | undefined>): string {
    let credentials = "absent";
    try {
      const stat = statSync(join(this.profileDir, "data", "opencode", "auth.json"));
      credentials = `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return `${environmentRevision(env)}:${credentials}`;
  }

  private armIdleReap(): void {
    if (this.leases > 0 || this.activeTurns > 0 || this.idleTimer) return;
    this.idleTimer = setTimeout(() => void this.shutdown(), this.idleShutdownMs);
  }
}

export async function discoverOpenCodeModels(supervisor: OpenCodeSupervisor, cwd: string, env?: Record<string, string | undefined>): Promise<DiscoveredOpenCodeModel[]> {
  const lease = await supervisor.acquire(env);
  try {
    return await waitForCatalog(modelCatalogFor(supervisor).load(lease, cwd));
  } finally {
    lease.release();
  }
}
