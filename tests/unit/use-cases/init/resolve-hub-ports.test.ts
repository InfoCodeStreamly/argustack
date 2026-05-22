/**
 * Unit tests for ResolveHubPortsUseCase.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ResolveHubPortsUseCase } from '../../../../src/use-cases/init/resolve-hub-ports.js';
import type { HubPorts } from '../../../../src/use-cases/init/resolve-hub-ports.js';
import { FakePlatformProbe } from '../../../fixtures/fakes/fake-platform-probe.js';

const DEFAULTS: HubPorts = {
  pg: 15432,
  pgweb: 15433,
  neo4jHttp: 15434,
  neo4jBolt: 15435,
  qdrantRest: 15436,
  qdrantGrpc: 15437,
};

describe('ResolveHubPortsUseCase', () => {
  let platform: FakePlatformProbe;
  let useCase: ResolveHubPortsUseCase;

  beforeEach(() => {
    platform = new FakePlatformProbe();
    useCase = new ResolveHubPortsUseCase(platform);
  });

  it('returns needsConfirmation=false when every default port is free', async () => {
    const result = await useCase.execute(DEFAULTS);

    expect(result.needsConfirmation).toBe(false);
    expect(result.plan).toHaveLength(6);
    expect(result.plan.every((p) => p.current === p.default)).toBe(true);
    expect(result.plan.every((p) => p.conflict === null)).toBe(true);
  });

  it('records the conflict and suggests the next free port when the default is busy', async () => {
    platform.portState.set(DEFAULTS.pg, { free: false, port: DEFAULTS.pg, pid: 42, processName: 'postgres' });

    const result = await useCase.execute(DEFAULTS);

    expect(result.needsConfirmation).toBe(true);
    const pgEntry = result.plan.find((p) => p.key === 'pg');
    expect(pgEntry?.conflict?.processName).toBe('postgres');
    expect(pgEntry?.suggested).toBe(DEFAULTS.pg + 1);
    expect(pgEntry?.current).toBe(DEFAULTS.pg + 1);
  });

  it('skips ports already chosen by earlier services so no two suggestions collide', async () => {
    platform.portState.set(DEFAULTS.pg, { free: false, port: DEFAULTS.pg, pid: 1, processName: 'a' });
    platform.portState.set(DEFAULTS.pgweb, { free: false, port: DEFAULTS.pgweb, pid: 2, processName: 'b' });

    const result = await useCase.execute(DEFAULTS);

    expect(result.needsConfirmation).toBe(true);
    const chosen = result.plan.map((p) => p.current);
    const unique = new Set(chosen);
    expect(unique.size).toBe(chosen.length);
  });

  it('returns suggested=null when no free port is found within the scan window (edge case)', async () => {
    for (let port = DEFAULTS.qdrantGrpc; port < DEFAULTS.qdrantGrpc + 25; port++) {
      platform.portState.set(port, { free: false, port, pid: port, processName: 'busy' });
    }

    const result = await useCase.execute(DEFAULTS);

    const grpcEntry = result.plan.find((p) => p.key === 'qdrantGrpc');
    expect(grpcEntry?.suggested).toBeNull();
    expect(grpcEntry?.current).toBe(DEFAULTS.qdrantGrpc);
  });
});
