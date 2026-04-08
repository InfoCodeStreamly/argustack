import { describe, it, expect } from 'vitest';

describe('registerGraphCommand', () => {
  it('exports registerGraphCommand function', async () => {
    const mod = await import('../../../src/cli/graph.js');
    expect(typeof mod.registerGraphCommand).toBe('function');
  });
});
