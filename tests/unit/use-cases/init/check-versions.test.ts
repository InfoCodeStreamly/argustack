/**
 * Unit tests for CheckVersionsUseCase.
 *
 * Uses FakePlatformProbe + FakeDockerControl to drive the version-gate
 * flow. The use case reads `process.versions.node` directly — we cannot
 * stub that, so tests assume the test runner is on a supported Node.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CheckVersionsUseCase } from '../../../../src/use-cases/init/check-versions.js';
import { FakePlatformProbe } from '../../../fixtures/fakes/fake-platform-probe.js';
import { FakeDockerControl } from '../../../fixtures/fakes/fake-docker-control.js';

describe('CheckVersionsUseCase', () => {
  let platform: FakePlatformProbe;
  let docker: FakeDockerControl;
  let useCase: CheckVersionsUseCase;

  beforeEach(() => {
    platform = new FakePlatformProbe();
    docker = new FakeDockerControl();
    useCase = new CheckVersionsUseCase(platform, docker);
  });

  it('returns ok=true when node + docker + compose all meet minimums', async () => {
    docker.versionInfo = { engine: '24.0.5', compose: '2.20.0' };

    const result = await useCase.execute();

    expect(result.ok).toBe(true);
    if (!result.ok) { return; }
    expect(result.docker).toEqual({ engine: '24.0.5', compose: '2.20.0' });
  });

  it('returns docker-missing when docker is not installed', async () => {
    docker.installed = false;

    const result = await useCase.execute();

    expect(result.ok).toBe(false);
    if (result.ok) { return; }
    expect(result.failure.kind).toBe('docker-missing');
  });

  it('returns docker-too-old when engine major < 20', async () => {
    docker.versionInfo = { engine: '19.03.0', compose: '2.20.0' };

    const result = await useCase.execute();

    expect(result.ok).toBe(false);
    if (result.ok) { return; }
    expect(result.failure.kind).toBe('docker-too-old');
    if (result.failure.kind !== 'docker-too-old') { return; }
    expect(result.failure.current).toBe('19.03.0');
  });

  it('returns compose-v1 when compose major < 2', async () => {
    docker.versionInfo = { engine: '24.0.0', compose: '1.29.2' };

    const result = await useCase.execute();

    expect(result.ok).toBe(false);
    if (result.ok) { return; }
    expect(result.failure.kind).toBe('compose-v1');
    if (result.failure.kind !== 'compose-v1') { return; }
    expect(result.failure.current).toBe('1.29.2');
  });

  it('returns ok=true with docker=null when version() returns null (edge case)', async () => {
    docker.versionInfo = null;

    const result = await useCase.execute();

    expect(result.ok).toBe(true);
    if (!result.ok) { return; }
    expect(result.docker).toBeNull();
  });
});
