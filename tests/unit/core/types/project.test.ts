import { describe, it, expect } from 'vitest';

describe('core/types/project module', () => {
  it('imports without errors', async () => {
    const mod = await import('../../../../src/core/types/project.js');
    expect(mod).toBeDefined();
  });
});
