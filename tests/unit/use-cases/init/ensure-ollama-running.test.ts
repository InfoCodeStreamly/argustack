/**
 * Unit tests for EnsureOllamaRunningUseCase.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EnsureOllamaRunningUseCase } from '../../../../src/use-cases/init/ensure-ollama-running.js';
import { FakeOllamaControl } from '../../../fixtures/fakes/fake-ollama-control.js';

describe('EnsureOllamaRunningUseCase', () => {
  let ollama: FakeOllamaControl;
  let useCase: EnsureOllamaRunningUseCase;

  beforeEach(() => {
    ollama = new FakeOllamaControl();
    useCase = new EnsureOllamaRunningUseCase(ollama);
  });

  it('returns alreadyRunning=true and never starts the daemon when ollama is up', async () => {
    ollama.running = true;

    const result = await useCase.execute();

    expect(result).toEqual({ ok: true, alreadyRunning: true });
    expect(ollama.startCalls).toHaveLength(0);
  });

  it('starts ollama in background and reports alreadyRunning=false when it becomes healthy', async () => {
    ollama.running = false;
    ollama.healthy = true;

    const result = await useCase.execute();

    expect(result).toEqual({ ok: true, alreadyRunning: false });
    expect(ollama.startCalls).toHaveLength(1);
  });

  it('returns timeout failure when waitHealthy resolves false', async () => {
    ollama.running = false;
    ollama.healthy = false;

    const result = await useCase.execute(5_000);

    expect(result).toEqual({ ok: false, reason: 'timeout' });
    expect(ollama.startCalls).toHaveLength(1);
  });
});
