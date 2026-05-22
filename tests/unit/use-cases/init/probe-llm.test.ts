/**
 * Unit tests for ProbeLlmUseCase.
 *
 * The use case retries transient failures with a fixed delay — tests use
 * fake timers so retries don't actually wait.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ProbeLlmUseCase } from '../../../../src/use-cases/init/probe-llm.js';
import { FakeOllamaControl } from '../../../fixtures/fakes/fake-ollama-control.js';
import type { ProbeResult } from '../../../../src/core/ports/ollama-control.js';

const INPUT = {
  url: 'http://localhost:11434',
  model: 'nomic-embed-text',
} as const;

describe('ProbeLlmUseCase', () => {
  let ollama: FakeOllamaControl;
  let useCase: ProbeLlmUseCase;

  beforeEach(() => {
    ollama = new FakeOllamaControl();
    useCase = new ProbeLlmUseCase(ollama);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns dims+attempts=1 on the first successful probe', async () => {
    ollama.probeResult = { ok: true, dims: 768 };

    const result = await useCase.execute({ ...INPUT, retries: 3, delayMs: 0 });

    expect(result).toEqual({ ok: true, dims: 768, attempts: 1 });
    expect(ollama.probeCalls).toHaveLength(1);
    expect(ollama.probeCalls[0]?.url).toBe(INPUT.url);
  });

  it('returns model-not-found immediately without retrying', async () => {
    ollama.probeResult = { ok: false, kind: 'model-not-found', details: 'model X not on host' };

    const result = await useCase.execute({ ...INPUT, retries: 5, delayMs: 0 });

    expect(result.ok).toBe(false);
    if (result.ok) { return; }
    expect(result.kind).toBe('model-not-found');
    expect(result.attempts).toBe(1);
    expect(ollama.probeCalls).toHaveLength(1);
  });

  it('retries transient errors up to `retries` times then returns lastKind', async () => {
    ollama.probeResult = { ok: false, kind: 'no-response', details: 'ECONNREFUSED' };

    const promise = useCase.execute({ ...INPUT, retries: 3, delayMs: 1000 });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.ok).toBe(false);
    if (result.ok) { return; }
    expect(result.kind).toBe('no-response');
    expect(result.attempts).toBe(3);
    expect(ollama.probeCalls).toHaveLength(3);
  });

  it('succeeds on the second retry when the first attempt is transient (edge case)', async () => {
    let calls = 0;
    const results: ProbeResult[] = [
      { ok: false, kind: 'timeout', details: 'first attempt timed out' },
      { ok: true, dims: 1024 },
    ];
    ollama.probeEmbedding = async (_model: string, _text: string, _url?: string): Promise<ProbeResult> => {
      await Promise.resolve();
      const value = results[calls] ?? results[results.length - 1];
      calls += 1;
      if (value === undefined) {
        throw new Error('unexpected call');
      }
      return value;
    };

    const promise = useCase.execute({ ...INPUT, retries: 3, delayMs: 500 });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toEqual({ ok: true, dims: 1024, attempts: 2 });
    expect(calls).toBe(2);
  });
});
