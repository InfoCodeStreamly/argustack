/**
 * Unit tests for EnsureEmbeddingModelUseCase.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EnsureEmbeddingModelUseCase } from '../../../../src/use-cases/init/ensure-embedding-model.js';
import { FakeOllamaControl } from '../../../fixtures/fakes/fake-ollama-control.js';

const MODEL = 'nomic-embed-text';

describe('EnsureEmbeddingModelUseCase', () => {
  let ollama: FakeOllamaControl;
  let useCase: EnsureEmbeddingModelUseCase;

  beforeEach(() => {
    ollama = new FakeOllamaControl();
    useCase = new EnsureEmbeddingModelUseCase(ollama);
  });

  it('returns alreadyPresent=true when the model is already in `ollama list`', async () => {
    ollama.models = [{ name: MODEL, sizeBytes: 1 }];

    const result = await useCase.execute(MODEL);

    expect(result).toEqual({ ok: true, alreadyPresent: true });
    expect(ollama.pullCalls).toHaveLength(0);
  });

  it('matches models stored with a `:latest` tag suffix (edge case)', async () => {
    ollama.models = [{ name: `${MODEL}:latest`, sizeBytes: 1 }];

    const result = await useCase.execute(MODEL);

    expect(result).toEqual({ ok: true, alreadyPresent: true });
    expect(ollama.pullCalls).toHaveLength(0);
  });

  it('pulls the model and reports progress when it is not present', async () => {
    ollama.models = [];
    const progressSeen: { pct: number; status: string }[] = [];

    const result = await useCase.execute(MODEL, (pct, status) => progressSeen.push({ pct, status }));

    expect(result).toEqual({ ok: true, alreadyPresent: false });
    expect(ollama.pullCalls).toEqual([{ name: MODEL }]);
    expect(progressSeen).toEqual([{ pct: 100, status: 'complete' }]);
  });

  it('propagates the pull failure kind+details when ollama pull fails', async () => {
    ollama.models = [];
    ollama.pullResult = { ok: false, kind: 'no-internet', details: 'dial tcp: timeout' };

    const result = await useCase.execute(MODEL);

    expect(result).toEqual({ ok: false, kind: 'no-internet', details: 'dial tcp: timeout' });
  });
});
