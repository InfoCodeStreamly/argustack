/**
 * Unit tests for CheckPortsUseCase.
 *
 * Uses FakePlatformProbe to exercise the port-conflict detection flow.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CheckPortsUseCase } from '../../../../src/use-cases/init/check-ports.js';
import { FakePlatformProbe } from '../../../fixtures/fakes/fake-platform-probe.js';

const PORTS = {
  pg: 15432,
  pgweb: 15433,
  neo4jHttp: 15434,
  neo4jBolt: 15435,
} as const;

describe('CheckPortsUseCase', () => {
  let platform: FakePlatformProbe;
  let useCase: CheckPortsUseCase;

  beforeEach(() => {
    platform = new FakePlatformProbe();
    useCase = new CheckPortsUseCase(platform);
  });

  it('returns free=true when every port is free', async () => {
    const result = await useCase.execute([PORTS.pg, PORTS.pgweb]);

    expect(result).toEqual({ free: true });
  });

  it('returns conflicts for each occupied port', async () => {
    platform.portState.set(PORTS.pg, { free: false, port: PORTS.pg, pid: 1234, processName: 'postgres' });
    platform.portState.set(PORTS.neo4jBolt, { free: false, port: PORTS.neo4jBolt, pid: 5678, processName: 'java' });

    const result = await useCase.execute([PORTS.pg, PORTS.pgweb, PORTS.neo4jBolt]);

    expect(result.free).toBe(false);
    if (result.free) { return; }
    expect(result.conflicts).toHaveLength(2);
    expect(result.conflicts.map((c) => c.port)).toEqual([PORTS.pg, PORTS.neo4jBolt]);
    expect(result.conflicts[0]?.processName).toBe('postgres');
  });

  it('returns free=true for empty port list (edge case)', async () => {
    const result = await useCase.execute([]);

    expect(result).toEqual({ free: true });
  });
});
