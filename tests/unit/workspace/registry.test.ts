import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  registerWorkspace,
  listLegacyWorkspaces,
  pruneDeadLegacyWorkspaces,
  type WorkspaceInfo,
} from '../../../src/workspace/registry.js';

describe('workspace registry (legacy)', () => {
  let tmpHome: string;
  let tmpWs1: string;
  let tmpWs2: string;

  beforeEach(() => {
    tmpHome = join(tmpdir(), `reg-test-${String(Date.now())}-${String(Math.random()).slice(2)}`);
    mkdirSync(tmpHome, { recursive: true });
    vi.stubEnv('ARGUSTACK_HUB_DIR', join(tmpHome, '.argustack'));

    tmpWs1 = join(tmpHome, 'ws1');
    tmpWs2 = join(tmpHome, 'ws2');

    mkdirSync(join(tmpWs1, '.argustack'), { recursive: true });
    writeFileSync(
      join(tmpWs1, '.argustack', 'config.json'),
      JSON.stringify({ version: 1, name: 'workspace-one', sources: {}, order: [] }),
    );

    mkdirSync(join(tmpWs2, '.argustack'), { recursive: true });
    writeFileSync(
      join(tmpWs2, '.argustack', 'config.json'),
      JSON.stringify({
        version: 1,
        name: 'workspace-two',
        sources: { jira: { enabled: true } },
        order: ['jira'],
      }),
    );
  });

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  describe('registerWorkspace', () => {
    it('creates registry file and adds workspace', () => {
      registerWorkspace(tmpWs1, 'workspace-one');

      const registryPath = join(tmpHome, '.argustack', 'workspaces.json');
      expect(existsSync(registryPath)).toBe(true);

      const workspaces = listLegacyWorkspaces();
      expect(workspaces).toHaveLength(1);
      expect(workspaces.at(0)?.name).toBe('workspace-one');
      expect(workspaces.at(0)?.path).toBe(tmpWs1);
    });

    it('is idempotent — same path not added twice', () => {
      registerWorkspace(tmpWs1, 'workspace-one');
      registerWorkspace(tmpWs1, 'workspace-one');

      const workspaces = listLegacyWorkspaces();
      expect(workspaces).toHaveLength(1);
    });

    it('registers multiple workspaces', () => {
      registerWorkspace(tmpWs1, 'workspace-one');
      registerWorkspace(tmpWs2, 'workspace-two');

      const workspaces = listLegacyWorkspaces();
      expect(workspaces).toHaveLength(2);
    });

    it('updates name in registry when called with new name', () => {
      registerWorkspace(tmpWs1, 'old-name');
      registerWorkspace(tmpWs1, 'new-name');

      const workspaces = listLegacyWorkspaces();
      expect(workspaces).toHaveLength(1);
      // Display name comes from config.json (workspace-one), not registry entry
      expect(workspaces.at(0)?.name).toBe('workspace-one');
    });
  });

  describe('listLegacyWorkspaces', () => {
    it('returns empty array when no registry exists', () => {
      const workspaces = listLegacyWorkspaces();
      expect(workspaces).toEqual([]);
    });

    it('returns active=false for all entries (hub model owns active state)', () => {
      registerWorkspace(tmpWs1, 'workspace-one');
      registerWorkspace(tmpWs2, 'workspace-two');

      const workspaces = listLegacyWorkspaces();
      expect(workspaces.every((w: WorkspaceInfo) => !w.active)).toBe(true);
    });

    it('reads sources from workspace config', () => {
      registerWorkspace(tmpWs2, 'workspace-two');

      const workspaces = listLegacyWorkspaces();
      expect(workspaces.at(0)?.sources).toContain('jira');
    });

    it('auto-prunes dead workspaces on read', () => {
      registerWorkspace(tmpWs1, 'workspace-one');
      registerWorkspace(tmpWs2, 'workspace-two');

      rmSync(tmpWs1, { recursive: true, force: true });

      const workspaces = listLegacyWorkspaces();
      expect(workspaces).toHaveLength(1);
      expect(workspaces.at(0)?.path).toBe(tmpWs2);
    });
  });

  describe('pruneDeadLegacyWorkspaces', () => {
    it('removes entries for deleted workspaces', () => {
      registerWorkspace(tmpWs1, 'workspace-one');
      registerWorkspace(tmpWs2, 'workspace-two');

      rmSync(tmpWs1, { recursive: true, force: true });
      rmSync(tmpWs2, { recursive: true, force: true });

      pruneDeadLegacyWorkspaces();

      const workspaces = listLegacyWorkspaces();
      expect(workspaces).toEqual([]);
    });

    it('keeps live workspaces', () => {
      registerWorkspace(tmpWs1, 'workspace-one');
      registerWorkspace(tmpWs2, 'workspace-two');

      rmSync(tmpWs1, { recursive: true, force: true });

      pruneDeadLegacyWorkspaces();

      const workspaces = listLegacyWorkspaces();
      expect(workspaces).toHaveLength(1);
      expect(workspaces.at(0)?.path).toBe(tmpWs2);
    });
  });
});
