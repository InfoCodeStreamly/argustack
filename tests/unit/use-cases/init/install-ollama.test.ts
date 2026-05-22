/**
 * Unit tests for InstallOllamaUseCase.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { InstallOllamaUseCase } from '../../../../src/use-cases/init/install-ollama.js';
import { FakeOllamaControl } from '../../../fixtures/fakes/fake-ollama-control.js';
import { FakePlatformProbe } from '../../../fixtures/fakes/fake-platform-probe.js';

describe('InstallOllamaUseCase', () => {
  let ollama: FakeOllamaControl;
  let platform: FakePlatformProbe;
  let useCase: InstallOllamaUseCase;

  beforeEach(() => {
    ollama = new FakeOllamaControl();
    platform = new FakePlatformProbe();
    useCase = new InstallOllamaUseCase(ollama, platform);
  });

  it('installs via brew on macOS when brew is available', async () => {
    platform.os = 'macos';
    platform.availableCommands.add('brew');
    ollama.installResult = { ok: true };

    const result = await useCase.execute();

    expect(result).toEqual({ ok: true, via: 'brew' });
  });

  it('falls back to curl on macOS when brew is missing', async () => {
    platform.os = 'macos';
    platform.availableCommands.delete('brew');
    platform.availableCommands.add('curl');
    ollama.installResult = { ok: true };

    const result = await useCase.execute();

    expect(result).toEqual({ ok: true, via: 'curl' });
  });

  it('installs via curl directly on Linux', async () => {
    platform.os = 'linux';
    platform.availableCommands.add('curl');
    ollama.installResult = { ok: true };

    const result = await useCase.execute();

    expect(result).toEqual({ ok: true, via: 'curl' });
  });

  it('rejects Windows with unsupported-os', async () => {
    platform.os = 'windows';

    const result = await useCase.execute();

    expect(result.ok).toBe(false);
    if (result.ok) { return; }
    expect(result.kind).toBe('unsupported-os');
  });

  it('returns brew-failed when brew install errors out on macOS', async () => {
    platform.os = 'macos';
    platform.availableCommands.add('brew');
    ollama.installResult = { ok: false, kind: 'unknown', details: 'brew exited 1' };

    const result = await useCase.execute();

    expect(result.ok).toBe(false);
    if (result.ok) { return; }
    expect(result.kind).toBe('brew-failed');
    expect(result.details).toBe('brew exited 1');
  });

  it('returns no-brew-no-curl when neither brew nor curl is available (edge case)', async () => {
    platform.os = 'linux';
    platform.availableCommands.delete('curl');

    const result = await useCase.execute();

    expect(result.ok).toBe(false);
    if (result.ok) { return; }
    expect(result.kind).toBe('no-brew-no-curl');
  });
});
