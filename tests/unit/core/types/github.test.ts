import { describe, it, expect } from 'vitest';

describe('core/types/github module', () => {
  it('imports without errors', async () => {
    const mod = await import('../../../../src/core/types/github.js');
    expect(mod).toBeDefined();
  });
});
