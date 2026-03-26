import { describe, it, expect } from 'vitest';

describe('core/types/issue module', () => {
  it('imports without errors', async () => {
    const mod = await import('../../../../src/core/types/issue.js');
    expect(mod).toBeDefined();
  });
});
