/**
 * Unit tests for WaitForDockerUseCase.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { WaitForDockerUseCase } from '../../../../src/use-cases/init/wait-for-docker.js';
import { FakeDockerControl } from '../../../fixtures/fakes/fake-docker-control.js';

describe('WaitForDockerUseCase', () => {
  let docker: FakeDockerControl;
  let useCase: WaitForDockerUseCase;

  beforeEach(() => {
    docker = new FakeDockerControl();
    useCase = new WaitForDockerUseCase(docker);
  });

  it('returns true when pollUntilRunning resolves true', async () => {
    docker.running = true;

    const ok = await useCase.execute();

    expect(ok).toBe(true);
    expect(docker.pollUntilRunningCalls).toHaveLength(1);
  });

  it('returns false when docker never comes up before timeout', async () => {
    docker.running = false;

    const ok = await useCase.execute({ timeoutMs: 10, intervalMs: 5 });

    expect(ok).toBe(false);
  });

  it('passes timeout, interval and onTick through to the port', async () => {
    docker.running = true;
    const ticks: number[] = [];

    await useCase.execute({ timeoutMs: 1234, intervalMs: 567, onTick: (s) => ticks.push(s) });

    expect(docker.pollUntilRunningCalls[0]).toEqual({ timeoutMs: 1234, intervalMs: 567 });
    expect(ticks).toEqual([0]);
  });
});
