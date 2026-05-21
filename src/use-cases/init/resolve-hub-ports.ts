import type { IPlatformProbe, PortInUse } from '../../core/ports/platform-probe.js';

export interface HubPorts {
  pg: number;
  pgweb: number;
  neo4jHttp: number;
  neo4jBolt: number;
  qdrantRest: number;
  qdrantGrpc: number;
}

export type HubPortKey = keyof HubPorts;

export interface PortPlanEntry {
  readonly key: HubPortKey;
  readonly default: number;
  readonly current: number;
  readonly conflict: PortInUse | null;
  readonly suggested: number | null;
}

export interface ResolveHubPortsResult {
  readonly plan: readonly PortPlanEntry[];
  /**
   * `true` when at least one port differs from its default — caller
   * should ask the user to confirm / customize. `false` means the
   * default set is fully usable and init can continue silently.
   */
  readonly needsConfirmation: boolean;
}

const MAX_FALLBACK_SCAN = 20;

const SERVICE_LABEL: Record<HubPortKey, string> = {
  pg: 'Postgres',
  pgweb: 'pgweb',
  neo4jHttp: 'Neo4j HTTP',
  neo4jBolt: 'Neo4j Bolt',
  qdrantRest: 'Qdrant REST',
  qdrantGrpc: 'Qdrant gRPC',
};

/**
 * Pre-bootstrap port planner. For each hub service:
 *   1. Try its default port.
 *   2. If occupied — record the conflict and scan forward up to
 *      `MAX_FALLBACK_SCAN` ports for a free one. The suggested
 *      number is the first free port found.
 *   3. Skip ports that are already chosen earlier in the plan so two
 *      services never collide on the same suggestion.
 *
 * Caller (init flow) then prompts the user per conflict: accept
 * suggestion, enter custom, or abort.
 */
export class ResolveHubPortsUseCase {
  constructor(private readonly platform: IPlatformProbe) {}

  async execute(defaults: HubPorts): Promise<ResolveHubPortsResult> {
    const plan: PortPlanEntry[] = [];
    const used = new Set<number>();
    let needsConfirmation = false;

    for (const key of Object.keys(defaults) as HubPortKey[]) {
      const defaultPort = defaults[key];
      const status = await this.platform.checkPort(defaultPort);
      if (status.free && !used.has(defaultPort)) {
        plan.push({ key, default: defaultPort, current: defaultPort, conflict: null, suggested: null });
        used.add(defaultPort);
        continue;
      }

      const conflict: PortInUse | null = status.free
        ? null
        : status;
      const suggested = await this.findFreePort(defaultPort + 1, used);
      plan.push({
        key,
        default: defaultPort,
        current: suggested ?? defaultPort,
        conflict,
        suggested,
      });
      if (suggested !== null) {
        used.add(suggested);
      }
      needsConfirmation = true;
    }

    return { plan, needsConfirmation };
  }

  private async findFreePort(start: number, alreadyChosen: Set<number>): Promise<number | null> {
    for (let i = 0; i < MAX_FALLBACK_SCAN; i++) {
      const candidate = start + i;
      if (candidate > 65535) { return null; }
      if (alreadyChosen.has(candidate)) { continue; }
      const status = await this.platform.checkPort(candidate);
      if (status.free) {
        return candidate;
      }
    }
    return null;
  }
}

export function labelForPortKey(key: HubPortKey): string {
  return SERVICE_LABEL[key];
}
