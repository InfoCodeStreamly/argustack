import type { IHubReadinessProbe } from '../../../src/core/ports/hub-readiness-probe.js';

/**
 * In-memory `IHubReadinessProbe`. Default behaviour: every probe call
 * resolves immediately to `{ ok: true }`. Configure failure or delayed
 * readiness via `result` and `delayMs`.
 */
export class FakeHubReadinessProbe implements IHubReadinessProbe {
  result: { ok: true } | { ok: false; details: string } = { ok: true };

  readonly waitForReadyCalls: number[] = [];

  async waitForReady(port: number): Promise<{ ok: true } | { ok: false; details: string }> {
    this.waitForReadyCalls.push(port);
    return Promise.resolve(this.result);
  }
}
