import { describe, it, expect } from 'vitest';

describe('core/types/git module', () => {
  it('imports without errors', async () => {
    const mod = await import('../../../../src/core/types/git.js');
    expect(mod).toBeDefined();
  });
});
