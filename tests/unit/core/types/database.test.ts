import { describe, it, expect } from 'vitest';

describe('core/types/database module', () => {
  it('imports without errors', async () => {
    const mod = await import('../../../../src/core/types/database.js');
    expect(mod).toBeDefined();
  });
});
