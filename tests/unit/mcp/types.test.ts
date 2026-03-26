import { describe, it, expect } from 'vitest';

describe('mcp/types module', () => {
  it('imports without errors', async () => {
    const mod = await import('../../../src/mcp/types.js');
    expect(mod).toBeDefined();
  });
});
