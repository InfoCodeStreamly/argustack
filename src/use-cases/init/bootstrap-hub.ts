import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import type { IDockerControl, ComposeUpResult } from '../../core/ports/docker-control.js';
import type { IHubReadinessProbe } from '../../core/ports/hub-readiness-probe.js';
import type { IWorkspaceStore } from '../../core/ports/workspace-store.js';
import type { HubPorts } from './resolve-hub-ports.js';

export interface BootstrapHubOptions {
  readonly hubDir: string;
  readonly templateComposePath: string;
  readonly templateConfigEnvPath: string;
  readonly ports: HubPorts;
  readonly skipDocker?: boolean;
  readonly onStep?: (step: string) => void;
}

export type BootstrapHubResult =
  | { ok: true; wroteCompose: boolean; wroteConfig: boolean }
  | { ok: false; stage: 'fs' | 'docker' | 'wait-db' | 'schema'; details: string; composeError?: ComposeUpResult };

/**
 * Factory producing an {@link IWorkspaceStore} bound to the freshly
 * bootstrapped hub Postgres. The use case knows nothing about how the
 * store is constructed — composition root (CLI) wires the concrete
 * adapter and pool. Synchronous: creating a pool is non-blocking; the
 * store performs the first await on `initialize()`.
 */
export type HubWorkspaceStoreFactory = (port: number) => {
  store: IWorkspaceStore;
  close: () => Promise<void>;
};

/**
 * Idempotent bootstrap of the hub stack:
 *   1. Ensure `<hubDir>/code/docker-compose.yml` is the hub variant
 *      (overwrites stale code-only legacy compose).
 *   2. Write `<hubDir>/code/.env` with HUB_*_PORT vars consumed by
 *      the compose file via ${VAR} substitution.
 *   3. Ensure `<hubDir>/config.env` exists from template.
 *   4. `docker compose up -d`.
 *   5. Poll the hub Postgres until it accepts authenticated SELECT 1.
 *      This handles the gap between container start and Postgres
 *      finishing initdb on first boot — without this the next step
 *      races and fails with "password authentication failed".
 *   6. Apply hub schema via `workspaceStore.initialize()`.
 */
export class BootstrapHubUseCase {
  constructor(
    private readonly docker: IDockerControl,
    private readonly readinessProbe: IHubReadinessProbe,
    private readonly workspaceStoreFactory: HubWorkspaceStoreFactory,
  ) {}

  async execute(options: BootstrapHubOptions): Promise<BootstrapHubResult> {
    const log = options.onStep ?? noop;
    let wroteCompose = false;
    let wroteConfig = false;

    try {
      if (!existsSync(options.hubDir)) { mkdirSync(options.hubDir, { recursive: true }); }
      const migrationsDir = join(options.hubDir, 'migrations');
      if (!existsSync(migrationsDir)) { mkdirSync(migrationsDir, { recursive: true }); }

      const composeTarget = join(options.hubDir, 'docker-compose.yml');
      const needsCompose = !existsSync(composeTarget) || !isHubCompose(composeTarget);
      if (needsCompose) {
        copyFileSync(options.templateComposePath, composeTarget);
        wroteCompose = true;
        log(`wrote ${composeTarget}`);
      }

      writeFileSync(join(options.hubDir, '.env'), renderPortsEnv(options.ports));
      log(`wrote ${join(options.hubDir, '.env')} (ports)`);

      const configTarget = join(options.hubDir, 'config.env');
      if (!existsSync(configTarget)) {
        writeFileSync(configTarget, readFileSync(options.templateConfigEnvPath, 'utf-8'));
        try { chmodSync(configTarget, 0o600); } catch { /* best-effort */ }
        wroteConfig = true;
        log(`wrote ${configTarget}`);
      }
    } catch (err) {
      return { ok: false, stage: 'fs', details: err instanceof Error ? err.message : String(err) };
    }

    if (options.skipDocker !== true) {
      log('docker compose up -d');
      const composePath = join(options.hubDir, 'docker-compose.yml');
      const composeResult = await this.docker.composeUp(composePath, options.hubDir);
      if (!composeResult.ok) {
        return { ok: false, stage: 'docker', details: composeResult.details, composeError: composeResult };
      }

      log('waiting for Postgres to accept connections');
      const ready = await this.readinessProbe.waitForReady(options.ports.pg);
      if (!ready.ok) {
        return { ok: false, stage: 'wait-db', details: ready.details };
      }
    }

    log('apply hub schema');
    const { store, close } = this.workspaceStoreFactory(options.ports.pg);
    try {
      await store.initialize();
    } catch (err) {
      return { ok: false, stage: 'schema', details: err instanceof Error ? err.message : String(err) };
    } finally {
      await close();
    }

    return { ok: true, wroteCompose, wroteConfig };
  }
}

/**
 * Detect whether an existing docker-compose.yml is the hub variant
 * (which defines `pg:` and `pgweb:` services) versus a stale legacy
 * code-only compose (only `neo4j:` + `qdrant:`). If it's the legacy
 * version, caller should overwrite from template so the hub services
 * come up.
 */
function isHubCompose(path: string): boolean {
  try {
    const content = readFileSync(path, 'utf-8');
    return /^\s+pg:\s*$/m.test(content) && /^\s+pgweb:\s*$/m.test(content);
  } catch {
    return false;
  }
}

function renderPortsEnv(ports: HubPorts): string {
  return [
    `HUB_PG_PORT=${String(ports.pg)}`,
    `HUB_PGWEB_PORT=${String(ports.pgweb)}`,
    `HUB_NEO4J_HTTP_PORT=${String(ports.neo4jHttp)}`,
    `HUB_NEO4J_BOLT_PORT=${String(ports.neo4jBolt)}`,
    `HUB_QDRANT_REST_PORT=${String(ports.qdrantRest)}`,
    `HUB_QDRANT_GRPC_PORT=${String(ports.qdrantGrpc)}`,
    '',
  ].join('\n');
}

function noop(_step: string): void { /* intentional */ }
