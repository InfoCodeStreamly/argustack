/**
 * Unit tests for BootstrapHubUseCase.
 *
 * The use case has filesystem side effects (writes compose, .env, config.env)
 * — tests redirect them to a temp directory and assert against the public
 * BootstrapHubResult outcome. Failures at each `stage` are exercised by
 * configuring the matching fake.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  BootstrapHubUseCase,
  type HubWorkspaceStoreFactory,
} from '../../../../src/use-cases/init/bootstrap-hub.js';
import type { HubPorts } from '../../../../src/use-cases/init/resolve-hub-ports.js';
import { FakeDockerControl } from '../../../fixtures/fakes/fake-docker-control.js';
import { FakeHubReadinessProbe } from '../../../fixtures/fakes/fake-hub-readiness-probe.js';
import { FakeWorkspaceStore } from '../../../fixtures/fakes/fake-workspace-store.js';

const PORTS: HubPorts = {
  pg: 25432,
  pgweb: 25433,
  neo4jHttp: 25434,
  neo4jBolt: 25435,
  qdrantRest: 25436,
  qdrantGrpc: 25437,
};

interface Harness {
  hubDir: string;
  templateComposePath: string;
  templateConfigEnvPath: string;
  docker: FakeDockerControl;
  readinessProbe: FakeHubReadinessProbe;
  storeFactory: HubWorkspaceStoreFactory;
  store: FakeWorkspaceStore;
  closeCalls: number;
}

function buildHarness(tempDir: string): Harness {
  const hubDir = join(tempDir, 'hub');
  const templatesDir = join(tempDir, 'templates');
  mkdirSync(templatesDir, { recursive: true });

  const templateComposePath = join(templatesDir, 'hub-docker-compose.yml');
  writeFileSync(
    templateComposePath,
    [
      'services:',
      '  pg:',
      '    image: pgvector/pgvector:pg16',
      '  pgweb:',
      '    image: sosedoff/pgweb',
      '',
    ].join('\n'),
  );

  const templateConfigEnvPath = join(templatesDir, 'hub-config.env');
  writeFileSync(templateConfigEnvPath, 'DB_HOST=localhost\nDB_USER=argustack\n');

  const docker = new FakeDockerControl();
  const readinessProbe = new FakeHubReadinessProbe();
  const store = new FakeWorkspaceStore();
  const harness: Harness = {
    hubDir,
    templateComposePath,
    templateConfigEnvPath,
    docker,
    readinessProbe,
    store,
    closeCalls: 0,
    storeFactory: () => ({
      store,
      close: async () => {
        harness.closeCalls += 1;
        await Promise.resolve();
      },
    }),
  };
  return harness;
}

describe('BootstrapHubUseCase', () => {
  let tempDir: string;
  let harness: Harness;
  let useCase: BootstrapHubUseCase;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'argustack-bootstrap-'));
    harness = buildHarness(tempDir);
    useCase = new BootstrapHubUseCase(
      harness.docker,
      harness.readinessProbe,
      harness.storeFactory,
    );
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns ok=true and writes compose + .env + config.env on first bootstrap', async () => {
    const steps: string[] = [];

    const result = await useCase.execute({
      hubDir: harness.hubDir,
      templateComposePath: harness.templateComposePath,
      templateConfigEnvPath: harness.templateConfigEnvPath,
      ports: PORTS,
      onStep: (s) => steps.push(s),
    });

    expect(result).toEqual({ ok: true, wroteCompose: true, wroteConfig: true });
    expect(existsSync(join(harness.hubDir, 'docker-compose.yml'))).toBe(true);
    expect(existsSync(join(harness.hubDir, 'config.env'))).toBe(true);
    expect(existsSync(join(harness.hubDir, '.env'))).toBe(true);
    expect(readFileSync(join(harness.hubDir, '.env'), 'utf-8')).toContain(
      `HUB_PG_PORT=${String(PORTS.pg)}`,
    );
    expect(harness.docker.composeUpCalls).toHaveLength(1);
    expect(harness.readinessProbe.waitForReadyCalls).toEqual([PORTS.pg]);
    expect(harness.closeCalls).toBe(1);
    expect(steps.some((s) => s.includes('apply hub schema'))).toBe(true);
  });

  it('returns stage=docker when composeUp fails', async () => {
    harness.docker.composeResult = { ok: false, kind: 'port-in-use', details: 'port 5432 bound' };

    const result = await useCase.execute({
      hubDir: harness.hubDir,
      templateComposePath: harness.templateComposePath,
      templateConfigEnvPath: harness.templateConfigEnvPath,
      ports: PORTS,
    });

    expect(result.ok).toBe(false);
    if (result.ok) { return; }
    expect(result.stage).toBe('docker');
    expect(result.details).toContain('port 5432 bound');
    expect(harness.readinessProbe.waitForReadyCalls).toHaveLength(0);
  });

  it('returns stage=wait-db when the readiness probe times out', async () => {
    harness.readinessProbe.result = { ok: false, details: 'pg_isready failed after 60s' };

    const result = await useCase.execute({
      hubDir: harness.hubDir,
      templateComposePath: harness.templateComposePath,
      templateConfigEnvPath: harness.templateConfigEnvPath,
      ports: PORTS,
    });

    expect(result.ok).toBe(false);
    if (result.ok) { return; }
    expect(result.stage).toBe('wait-db');
    expect(result.details).toContain('pg_isready failed');
  });

  it('returns stage=schema and still closes the store when initialize throws', async () => {
    harness.store.initialize = async (): Promise<never> => {
      await Promise.resolve();
      throw new Error('relation already exists');
    };

    const result = await useCase.execute({
      hubDir: harness.hubDir,
      templateComposePath: harness.templateComposePath,
      templateConfigEnvPath: harness.templateConfigEnvPath,
      ports: PORTS,
    });

    expect(result.ok).toBe(false);
    if (result.ok) { return; }
    expect(result.stage).toBe('schema');
    expect(result.details).toContain('relation already exists');
    expect(harness.closeCalls).toBe(1);
  });

  it('skips docker calls when skipDocker=true', async () => {
    const result = await useCase.execute({
      hubDir: harness.hubDir,
      templateComposePath: harness.templateComposePath,
      templateConfigEnvPath: harness.templateConfigEnvPath,
      ports: PORTS,
      skipDocker: true,
    });

    expect(result.ok).toBe(true);
    expect(harness.docker.composeUpCalls).toHaveLength(0);
    expect(harness.readinessProbe.waitForReadyCalls).toHaveLength(0);
    expect(harness.closeCalls).toBe(1);
  });

  it('preserves an existing hub compose and config.env across re-runs (edge case)', async () => {
    mkdirSync(harness.hubDir, { recursive: true });
    writeFileSync(
      join(harness.hubDir, 'docker-compose.yml'),
      [
        'services:',
        '  pg:',
        '    image: original',
        '  pgweb:',
        '    image: original',
        '',
      ].join('\n'),
    );
    writeFileSync(join(harness.hubDir, 'config.env'), 'CUSTOM=keep-me\n');

    const result = await useCase.execute({
      hubDir: harness.hubDir,
      templateComposePath: harness.templateComposePath,
      templateConfigEnvPath: harness.templateConfigEnvPath,
      ports: PORTS,
    });

    expect(result).toEqual({ ok: true, wroteCompose: false, wroteConfig: false });
    expect(readFileSync(join(harness.hubDir, 'config.env'), 'utf-8')).toContain('CUSTOM=keep-me');
    expect(readFileSync(join(harness.hubDir, 'docker-compose.yml'), 'utf-8')).toContain('image: original');
  });
});
