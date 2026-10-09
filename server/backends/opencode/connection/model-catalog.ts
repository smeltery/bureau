import { EFFORT_LEVELS } from "../../../../shared/types.ts";
import { allowDiscoveredModels, type DiscoveredOpenCodeModel } from "../parse.ts";
import type { OpenCodeLease, OpenCodeSupervisor } from "../supervisor.ts";
import { fetchOpenCode, OPENCODE_DEADLINE_MS } from "./deadlines.ts";

export function catalogIdentity(lease: OpenCodeLease): string {
  return `${lease.pid}:${lease.baseUrl}:${lease.authHeader}`;
}

export class OpenCodeModelCatalog {
  private identity: string | null = null;
  private loads = new Map<string, Promise<DiscoveredOpenCodeModel[]>>();

  constructor(private readonly loadTimeoutMs = 5 * 60_000) {}

  load(lease: OpenCodeLease, cwd: string): Promise<DiscoveredOpenCodeModel[]> {
    const identity = catalogIdentity(lease);
    if (this.identity !== identity) {
      this.identity = identity;
      this.loads = new Map();
    }
    const loads = this.loads;
    const existing = loads.get(cwd);
    if (existing) return existing;
    const url = new URL("/provider", lease.baseUrl);
    url.searchParams.set("directory", cwd);
    const pending = fetchOpenCode(url, { headers: { authorization: lease.authHeader } }, this.loadTimeoutMs).then(async (response) => {
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`OpenCode model catalog returned HTTP ${response.status}.`);
      }
      return allowDiscoveredModels(await response.json());
    });
    loads.set(cwd, pending);
    void pending.catch(() => {
      if (loads.get(cwd) === pending) loads.delete(cwd);
    });
    return pending;
  }
}

const catalogs = new WeakMap<OpenCodeSupervisor, OpenCodeModelCatalog>();
export function modelCatalogFor(supervisor: OpenCodeSupervisor): OpenCodeModelCatalog {
  let catalog = catalogs.get(supervisor);
  if (!catalog) {
    catalog = new OpenCodeModelCatalog();
    catalogs.set(supervisor, catalog);
  }
  return catalog;
}

export async function waitForCatalog(load: Promise<DiscoveredOpenCodeModel[]>, timeoutMs = OPENCODE_DEADLINE_MS): Promise<DiscoveredOpenCodeModel[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      load,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("OpenCode model catalog is not ready.")), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Keeps a turn's prefetch even if it fails, so the same turn never loads twice. */
export class OpenCodeModelSelection {
  private prefetchLoad: { identity: string; load: Promise<DiscoveredOpenCodeModel[]> } | null = null;
  contextLimit: number | undefined;
  constructor(
    private readonly catalog: OpenCodeModelCatalog,
    private readonly cwd: string,
    private readonly model: string,
    private readonly effort: string | undefined,
    private readonly waitMs = OPENCODE_DEADLINE_MS,
  ) {}

  prefetch(lease: OpenCodeLease): void {
    const load = this.catalog.load(lease, this.cwd);
    void load.catch(() => undefined);
    this.prefetchLoad = { identity: catalogIdentity(lease), load };
  }

  async resolve(lease: OpenCodeLease): Promise<{ variant?: string; notice?: string }> {
    const identity = catalogIdentity(lease);
    const pending = this.prefetchLoad;
    this.prefetchLoad = null;
    let models: DiscoveredOpenCodeModel[];
    try {
      models = await waitForCatalog(pending?.identity === identity ? pending.load : this.catalog.load(lease, this.cwd), this.waitMs);
    } catch {
      this.contextLimit = undefined;
      return { notice: "OpenCode's model catalog is unavailable. This turn uses the model's default effort." };
    }
    if (catalogIdentity(lease) !== identity) return this.resolve(lease);
    const model = models.find((model) => model.id === this.model);
    this.contextLimit = model?.contextLimit;
    const levels = model?.supportedEfforts ?? [];
    if (this.effort && levels.some((option) => option.level === this.effort)) return { variant: this.effort };
    if (!this.effort || levels.length === 0) return {};
    const label = EFFORT_LEVELS.find((option) => option.level === this.effort)?.label ?? this.effort;
    return { notice: `OpenCode does not offer ${label} effort for this model. This turn uses the model's default effort.` };
  }
}
