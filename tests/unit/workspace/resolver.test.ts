import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  findLegacyWorkspaceId,
  findLegacyWorkspaceRoot,
  requireWorkspaceId,
} from '../../../src/workspace/resolver.js';
import type { IWorkspaceStore } from '../../../src/core/ports/workspace-store.js';
import type { Workspace, WorkspaceSettings } from '../../../src/core/types/workspace.js';

function makeStore(workspaces: Workspace[]): IWorkspaceStore {
  async function createImpl(w: Workspace): Promise<Workspace> {
    return Promise.resolve(w);
  }
  async function getByIdImpl(id: string): Promise<Workspace | null> {
    return Promise.resolve(workspaces.find((w) => w.id === id) ?? null);
  }
  async function getByNameImpl(name: string): Promise<Workspace | null> {
    return Promise.resolve(workspaces.find((w) => w.name === name) ?? null);
  }

  return {
    name: 'fake-store',
    initialize: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    create: vi.fn<(w: Workspace) => Promise<Workspace>>().mockImplementation(createImpl),
    getById: vi.fn<(id: string) => Promise<Workspace | null>>().mockImplementation(getByIdImpl),
    getByName: vi.fn<(name: string) => Promise<Workspace | null>>().mockImplementation(getByNameImpl),
    list: vi.fn<() => Promise<Workspace[]>>().mockResolvedValue(workspaces),
    updateSettings: vi.fn<(id: string, patch: Partial<WorkspaceSettings>) => Promise<void>>()
      .mockResolvedValue(undefined),
    remove: vi.fn<(id: string) => Promise<void>>().mockResolvedValue(undefined),
    touchActive: vi.fn<(id: string) => Promise<void>>().mockResolvedValue(undefined),
    close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  };
}

describe('workspace resolver', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'argustack-test-'));
    vi.stubEnv('ARGUSTACK_WORKSPACE_ID', '');
    vi.stubEnv('ARGUSTACK_HUB_DIR', join(tempDir, 'hub'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  describe('findLegacyWorkspaceRoot', () => {
    it('returns directory containing legacy .argustack/config.json', () => {
      mkdirSync(join(tempDir, '.argustack'));
      writeFileSync(
        join(tempDir, '.argustack', 'config.json'),
        JSON.stringify({ workspaceId: 'ws-one' }),
      );

      const result = findLegacyWorkspaceRoot(tempDir);

      expect(result).toBe(tempDir);
    });

    it('walks up from nested directory', () => {
      mkdirSync(join(tempDir, '.argustack'));
      writeFileSync(
        join(tempDir, '.argustack', 'config.json'),
        JSON.stringify({ workspaceId: 'ws-one' }),
      );
      const nested = join(tempDir, 'sub', 'deep');
      mkdirSync(nested, { recursive: true });

      const result = findLegacyWorkspaceRoot(nested);

      expect(result).toBe(tempDir);
    });

    it('returns null when no legacy workspace found', () => {
      const result = findLegacyWorkspaceRoot(tempDir);

      expect(result).toBeNull();
    });
  });

  describe('findLegacyWorkspaceId', () => {
    it('returns workspaceId from legacy config.json', () => {
      mkdirSync(join(tempDir, '.argustack'));
      writeFileSync(
        join(tempDir, '.argustack', 'config.json'),
        JSON.stringify({ workspaceId: 'legacy-id' }),
      );

      const result = findLegacyWorkspaceId(tempDir);

      expect(result).toBe('legacy-id');
    });

    it('falls back to name when workspaceId is absent', () => {
      mkdirSync(join(tempDir, '.argustack'));
      writeFileSync(
        join(tempDir, '.argustack', 'config.json'),
        JSON.stringify({ name: 'legacy-name' }),
      );

      const result = findLegacyWorkspaceId(tempDir);

      expect(result).toBe('legacy-name');
    });

    it('returns null when no legacy config exists', () => {
      const result = findLegacyWorkspaceId(tempDir);

      expect(result).toBeNull();
    });
  });

  describe('requireWorkspaceId', () => {
    it('returns id from explicit argument (by id)', async () => {
      const store = makeStore([{ id: 'ws-one', name: 'workspace-one' }]);

      const result = await requireWorkspaceId('ws-one', store);

      expect(result).toBe('ws-one');
    });

    it('returns id from explicit argument (by name)', async () => {
      const store = makeStore([{ id: 'ws-one', name: 'workspace-one' }]);

      const result = await requireWorkspaceId('workspace-one', store);

      expect(result).toBe('ws-one');
    });

    it('throws when explicit workspace not found', async () => {
      const store = makeStore([{ id: 'ws-one', name: 'workspace-one' }]);

      await expect(requireWorkspaceId('missing', store)).rejects.toThrow(/not found/);
    });

    it('auto-picks the only workspace when none specified', async () => {
      const store = makeStore([{ id: 'only', name: 'only-ws' }]);

      const result = await requireWorkspaceId(undefined, store);

      expect(result).toBe('only');
    });

    it('throws when no workspaces are registered', async () => {
      const store = makeStore([]);

      await expect(requireWorkspaceId(undefined, store)).rejects.toThrow(/No workspaces registered/);
    });

    it('throws when multiple workspaces exist and none specified', async () => {
      const store = makeStore([
        { id: 'a', name: 'a' },
        { id: 'b', name: 'b' },
      ]);

      await expect(requireWorkspaceId(undefined, store)).rejects.toThrow(/No active workspace/);
    });

    it('resolves via ARGUSTACK_WORKSPACE_ID env var', async () => {
      vi.stubEnv('ARGUSTACK_WORKSPACE_ID', 'ws-from-env');
      const store = makeStore([{ id: 'ws-from-env', name: 'workspace-env' }]);

      const result = await requireWorkspaceId(undefined, store);

      expect(result).toBe('ws-from-env');
    });
  });
});
