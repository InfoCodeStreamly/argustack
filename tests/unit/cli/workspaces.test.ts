import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/workspace/resolver.js', () => ({
  findWorkspaceRoot: vi.fn(() => null),
}));

vi.mock('../../../src/workspace/registry.js', () => ({
  listRegisteredWorkspaces: vi.fn(() => []),
}));

describe('registerWorkspacesCommand', () => {
  it('exports registerWorkspacesCommand function', async () => {
    const mod = await import('../../../src/cli/workspaces.js');
    expect(typeof mod.registerWorkspacesCommand).toBe('function');
  });
});
