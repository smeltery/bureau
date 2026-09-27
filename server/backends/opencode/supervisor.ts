// Local OpenCode `serve` supervisor. One shared process under ~/.bureau/opencode,
// leased by transports and idle-reaped between turns.

import { spawn, type ChildProcess } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { BUREAU_DIR } from "../../persistence/paths.ts";
import { DEFAULT_OPENCODE_CONFIG } from "./config.ts";
import { allowDiscoveredModels, type DiscoveredOpenCodeModel } from "./parse.ts";
import { resolveOpenCodeBinary } from "./runtime.ts";

export const OPENCODE_IDLE_SHUTDOWN_MS = 10 * 60 * 1000;
const USERNAME = "bureau";
const HEALTH_TIMEOUT_MS = 8_000;

interface ServerRecord {
  pid: number;
  port: number;
  password: string;
}

export interface OpenCodeLease {
  baseUrl: string;
  authHeader: string;
  pid: number;
  release(): void;
  beginTurn(): Promise<void>;
  recoverBeforePrompt(): Promise<void>;
  endTurn(): void;
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
  readonly profileDir: string;
  private readonly binary: string | undefined;
  private readonly config: Record<string, unknown>;
  private readonly idleShutdownMs: number;
  private readonly launchEnv: Record<string, string | undefined>;

  constructor(options: OpenCodeSupervisorOptions = {}) {
    this.profileDir = options.profileDir ?? join(BUREAU_DIR, "opencode", "profiles", "default");
    this.binary = options.binary;
    this.config = { ...(options.config ?? DEFAULT_OPENCODE_CONFIG), autoupdate: false };
    this.idleShutdownMs = options.idleShutdownMs ?? OPENCODE_IDLE_SHUTDOWN_MS;
    this.launchEnv = options.launchEnv ?? {};
  }

  async acquire(): Promise<OpenCodeLease> {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    await this.ensureServer();
    this.leases++;
    let released = false;
    let turnActive = false;
    const record = () => this.record!;
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
        await this.validateServerForTurn(this.activeTurns > 0);
        turnActive = true;
        this.activeTurns++;
        if (this.idleTimer) clearTimeout(this.idleTimer);
        this.idleTimer = null;
      },
      recoverBeforePrompt: async () => {
        if (released || !turnActive) return;
        await this.validateServerForTurn(this.activeTurns > 1);
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

  private async ensureServer(): Promise<void> {
    if (this.record && (await this.healthy(this.record))) return;
    if (this.starting) {
      await this.starting;
      return;
    }
    this.starting = this.startServer().finally(() => {
      this.starting = null;
    });
    await this.starting;
  }

  private async validateServerForTurn(otherTurnActive: boolean): Promise<void> {
    if (!this.record || !(await this.healthy(this.record))) {
      if (otherTurnActive) throw new Error("OpenCode server health check failed during an active turn.");
      await this.ensureServer();
    }
  }

  private async startServer(): Promise<void> {
    await this.shutdown();
    await mkdir(this.profileDir, { recursive: true });
    const configPath = join(this.profileDir, "opencode.json");
    await writeFile(configPath, `${JSON.stringify(this.config)}\n`, { mode: 0o600 });
    await chmod(configPath, 0o600);
    const binary = this.binary ?? resolveOpenCodeBinary();
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
        started = { pid: child.pid, port, password };
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
  }

  private childEnv(password: string, configPath: string): NodeJS.ProcessEnv {
    const filtered = Object.fromEntries(Object.entries({ ...process.env, ...this.launchEnv }).filter(([name]) => name === "OPENCODE_API_KEY" || !name.startsWith("OPENCODE_")));
    return {
      ...filtered,
      PATH: process.env.PATH ?? "/usr/bin:/bin",
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
    } catch {
      return false;
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

  private armIdleReap(): void {
    if (this.leases > 0 || this.activeTurns > 0 || this.idleTimer) return;
    this.idleTimer = setTimeout(() => void this.shutdown(), this.idleShutdownMs);
  }
}

let shared: OpenCodeSupervisor | null = null;

export function getSharedOpenCodeSupervisor(launchEnv?: Record<string, string | undefined>): OpenCodeSupervisor {
  if (!shared) {
    shared = new OpenCodeSupervisor({ launchEnv });
  }
  return shared;
}

export async function discoverOpenCodeModels(supervisor: OpenCodeSupervisor, cwd: string): Promise<DiscoveredOpenCodeModel[]> {
  const lease = await supervisor.acquire();
  try {
    const url = new URL("/provider", lease.baseUrl);
    url.searchParams.set("directory", cwd);
    const response = await fetch(url, { headers: { authorization: lease.authHeader } });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`OpenCode HTTP ${response.status} at /provider.`);
    }
    return allowDiscoveredModels(await response.json());
  } finally {
    lease.release();
  }
}
