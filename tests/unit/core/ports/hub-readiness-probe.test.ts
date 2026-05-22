/**
 * Type-contract tests for `IHubReadinessProbe` port. The port has a
 * single method; the test verifies that the fake implementation matches
 * the documented signature and that the result discriminated union
 * accepts both branches.
 */

import { describe, it, expect } from 'vitest';
import type { IHubReadinessProbe } from '../../../../src/core/ports/hub-readiness-probe.js';
import { FakeHubReadinessProbe } from '../../../fixtures/fakes/fake-hub-readiness-probe.js';

describe('IHubReadinessProbe port contract', () => {
  it('FakeHubReadinessProbe satisfies IHubReadinessProbe', () => {
    const probe: IHubReadinessProbe = new FakeHubReadinessProbe();

    expect(typeof probe.waitForReady).toBe('function');
  });

  it('waitForReady returns ok-result by default', async () => {
    const probe = new FakeHubReadinessProbe();

    const result = await probe.waitForReady(15432);

    expect(result).toEqual({ ok: true });
  });

  it('waitForReady can return a classified failure', async () => {
    const probe = new FakeHubReadinessProbe();
    probe.result = { ok: false, details: 'timeout' };

    const result = await probe.waitForReady(15432);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.details).toBe('timeout');
    }
  });

  it('records port arguments for assertion', async () => {
    const probe = new FakeHubReadinessProbe();

    await probe.waitForReady(15432);
    await probe.waitForReady(5434);

    expect(probe.waitForReadyCalls).toEqual([15432, 5434]);
  });
});
