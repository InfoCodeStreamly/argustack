import { describe, it, expect } from 'vitest';

describe('core/types/board module', () => {
  it('imports without errors', async () => {
    const mod = await import('../../../../src/core/types/board.js');
    expect(mod).toBeDefined();
  });
});
