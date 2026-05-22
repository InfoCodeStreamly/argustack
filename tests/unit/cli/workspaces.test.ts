import { describe, it, expect } from 'vitest';

describe('registerWorkspaceCommands', () => {
  it('exports registerWorkspaceCommands function', async () => {
    const mod = await import('../../../src/cli/workspace/index.js');
    expect(typeof mod.registerWorkspaceCommands).toBe('function');
  });
});
