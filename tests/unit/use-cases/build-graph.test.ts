import { describe, it, expect } from 'vitest';

describe('BuildGraphUseCase', () => {
  it('exports BuildGraphUseCase class', async () => {
    const mod = await import('../../../src/use-cases/build-graph.js');
    expect(typeof mod.BuildGraphUseCase).toBe('function');
  });
});
