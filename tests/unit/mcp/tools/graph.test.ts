import { describe, it, expect } from 'vitest';

describe('registerGraphTools', () => {
  it('exports registerGraphTools function', async () => {
    const mod = await import('../../../../src/mcp/tools/graph.js');
    expect(typeof mod.registerGraphTools).toBe('function');
  });
});
