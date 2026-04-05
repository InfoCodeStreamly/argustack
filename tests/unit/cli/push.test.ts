import { describe, it, expect } from 'vitest';

describe('push command', () => {
  it('registerPushCommand exports a function', async () => {
    const { registerPushCommand } = await import('../../../src/cli/push.js');
    expect(typeof registerPushCommand).toBe('function');
  });
});
