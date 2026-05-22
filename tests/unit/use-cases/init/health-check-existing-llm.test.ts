/**
 * Unit tests for HealthCheckExistingLlmUseCase.
 *
 * The use case wraps ProbeLlmUseCase — tests inject a real ProbeLlmUseCase
 * with a FakeOllamaControl so the integration between the two layers is
 * exercised.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { HealthCheckExistingLlmUseCase } from '../../../../src/use-cases/init/health-check-existing-llm.js';
import { ProbeLlmUseCase } from '../../../../src/use-cases/init/probe-llm.js';
import { FakeOllamaControl } from '../../../fixtures/fakes/fake-ollama-control.js';
import type { HubConfig } from '../../../../src/workspace/hub-config.js';

function buildConfig(overrides: Partial<HubConfig['embedding']>): HubConfig {
  return {
    hubDir: '/tmp/hub',
    db: { host: 'localhost', port: 15432, user: 'u', password: 'p', database: 'd' },
    neo4j: { uri: 'bolt://localhost:15435', user: 'neo4j', password: 'p' },
    qdrant: { url: 'http://localhost:15436' },
    embedding: {
      provider: 'ollama',
      model: 'nomic-embed-text',
      dimensions: 768,
      userConfigured: true,
      ...overrides,
    },
    chatLlm: null,
    credentials: {},
  };
}

describe('HealthCheckExistingLlmUseCase', () => {
  let ollama: FakeOllamaControl;
  let useCase: HealthCheckExistingLlmUseCase;

  beforeEach(() => {
    ollama = new FakeOllamaControl();
    useCase = new HealthCheckExistingLlmUseCase(new ProbeLlmUseCase(ollama));
  });

  it('reports healthy=true with dims when the probe succeeds', async () => {
    ollama.probeResult = { ok: true, dims: 768 };

    const result = await useCase.execute(buildConfig({ provider: 'ollama' }));

    expect(result).toEqual({ configured: true, healthy: true, dims: 768 });
    expect(ollama.probeCalls[0]?.url).toBe('http://localhost:11434');
  });

  it('returns configured=false when the embedding section is not user-configured', async () => {
    const result = await useCase.execute(buildConfig({ userConfigured: false }));

    expect(result).toEqual({ configured: false });
    expect(ollama.probeCalls).toHaveLength(0);
  });

  it('returns healthy=false with details when the probe fails', async () => {
    ollama.probeResult = { ok: false, kind: 'model-not-found', details: 'no model on host' };

    const result = await useCase.execute(buildConfig({ provider: 'ollama' }));

    expect(result.configured).toBe(true);
    if (!result.configured) { return; }
    expect(result.healthy).toBe(false);
    if (result.healthy) { return; }
    expect(result.details).toContain('model-not-found');
    expect(result.details).toContain('no model on host');
  });

  it('uses the custom URL when provider=custom (edge case)', async () => {
    ollama.probeResult = { ok: true, dims: 512 };

    const result = await useCase.execute(
      buildConfig({ provider: 'custom', customUrl: 'http://example.com:9000' }),
    );

    expect(result).toEqual({ configured: true, healthy: true, dims: 512 });
    expect(ollama.probeCalls[0]?.url).toBe('http://example.com:9000');
  });

  it('treats provider=voyage as not configured (no URL to probe)', async () => {
    const result = await useCase.execute(buildConfig({ provider: 'voyage' }));

    expect(result).toEqual({ configured: false });
    expect(ollama.probeCalls).toHaveLength(0);
  });
});
