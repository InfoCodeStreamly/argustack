/**
 * Type-contract tests for `IOllamaControl` port. The port is
 * interface-only — these tests exercise the shape via the
 * {@link FakeOllamaControl} fake and verify each discriminated-union
 * result type accepts both success and classified-failure variants.
 */

import { describe, it, expect } from 'vitest';
import type {
  IOllamaControl,
  InstallResult,
  PullResult,
  ProbeResult,
  OllamaModel,
} from '../../../../src/core/ports/ollama-control.js';
import { FakeOllamaControl } from '../../../fixtures/fakes/fake-ollama-control.js';

describe('IOllamaControl port contract', () => {
  it('FakeOllamaControl satisfies IOllamaControl', () => {
    const ctl: IOllamaControl = new FakeOllamaControl();

    expect(ctl.name).toBeTruthy();
    expect(typeof ctl.isInstalled).toBe('function');
    expect(typeof ctl.isRunning).toBe('function');
    expect(typeof ctl.version).toBe('function');
    expect(typeof ctl.installViaBrew).toBe('function');
    expect(typeof ctl.installViaCurl).toBe('function');
    expect(typeof ctl.startInBackground).toBe('function');
    expect(typeof ctl.waitHealthy).toBe('function');
    expect(typeof ctl.listModels).toBe('function');
    expect(typeof ctl.pullModel).toBe('function');
    expect(typeof ctl.probeEmbedding).toBe('function');
  });

  it('InstallResult discriminates ok and failure', () => {
    const ok: InstallResult = { ok: true };
    const fail: InstallResult = { ok: false, kind: 'no-brew', details: 'brew missing' };

    expect(ok.ok).toBe(true);
    expect(fail.ok).toBe(false);
  });

  it('PullResult and ProbeResult expose dims on success', () => {
    const pullVariants: PullResult[] = [{ ok: true }];
    const probeVariants: ProbeResult[] = [
      { ok: true, dims: 1024 },
      { ok: false, kind: 'no-response', details: 'down' },
    ];

    expect(pullVariants[0]?.ok).toBe(true);

    let dims: number | null = null;
    let failKind: string | null = null;
    for (const variant of probeVariants) {
      if (variant.ok) {
        dims = variant.dims;
      } else {
        failKind = variant.kind;
      }
    }
    expect(dims).toBe(1024);
    expect(failKind).toBe('no-response');
  });

  it('OllamaModel exposes name and sizeBytes', () => {
    const model: OllamaModel = { name: 'nomic-embed-text', sizeBytes: 274_000_000 };

    expect(model.name).toBe('nomic-embed-text');
    expect(model.sizeBytes).toBeGreaterThan(0);
  });

  it('FakeOllamaControl methods return promises with default healthy values', async () => {
    const ctl = new FakeOllamaControl();

    await expect(ctl.isInstalled()).resolves.toBe(true);
    await expect(ctl.isRunning()).resolves.toBe(true);
    await expect(ctl.version()).resolves.toBe('0.1.0');
    await expect(ctl.waitHealthy(1000)).resolves.toBe(true);
  });
});
