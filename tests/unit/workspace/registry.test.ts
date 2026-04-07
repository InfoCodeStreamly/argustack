import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...(actual as Record<string, unknown>), homedir: vi.fn() };
});

import { homedir } from 'node:os';
import { registerWorkspace, listRegisteredWorkspaces, pruneDeadWorkspaces } from '../../../src/workspace/registry.js';

describe('workspace registry', () => {
  let tmpHome: string;
  let tmpWs1: string;
  let tmpWs2: string;

  beforeEach(() => {
    tmpHome = join(tmpdir(), `reg-test-${String(Date.now())}`);
    mkdirSync(tmpHome, { recursive: true });
    vi.mocked(homedir).mockReturnValue(tmpHome);

    tmpWs1 = join(tmpHome, 'ws1');
    tmpWs2 = join(tmpHome, 'ws2');

    mkdirSync(join(tmpWs1, '.argustack'), { recursive: true });
    writeFileSync(join(tmpWs1, '.argustack', 'config.json'), JSON.stringify({ version: 1, name: 'workspace-one', sources: {}, order: [] }));

    mkdirSync(join(tmpWs2, '.argustack'), { recursive: true });
    writeFileSync(join(tmpWs2, '.argustack', 'config.json'), JSON.stringify({ version: 1, name: 'workspace-two', sources: { jira: { enabled: true } }, order: ['jira'] }));
  });

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe('registerWorkspace', () => {
    it('creates registry file and adds workspace', () => {
      registerWorkspace(tmpWs1, 'workspace-one');

      const registryPath = join(tmpHome, '.argustack', 'workspaces.json');
      expect(existsSync(registryPath)).toBe(true);

      const workspaces = listRegisteredWorkspaces();
      expect(workspaces).toHaveLength(1);
      expect(workspaces.at(0)?.name).toBe('workspace-one');
      expect(workspaces.at(0)?.path).toBe(tmpWs1);
    });

    it('is idempotent — same path not added twice', () => {
      registerWorkspace(tmpWs1, 'workspace-one');
      registerWorkspace(tmpWs1, 'workspace-one');

      const workspaces = listRegisteredWorkspaces();
      expect(workspaces).toHaveLength(1);
    });

    it('registers multiple workspaces', () => {
      registerWorkspace(tmpWs1, 'workspace-one');
      registerWorkspace(tmpWs2, 'workspace-two');

      const workspaces = listRegisteredWorkspaces();
      expect(workspaces).toHaveLength(2);
    });

    it('updates name if path already registered with different name', () => {
      registerWorkspace(tmpWs1, 'old-name');
      registerWorkspace(tmpWs1, 'new-name');

      const workspaces = listRegisteredWorkspaces();
      expect(workspaces).toHaveLength(1);
      expect(workspaces.at(0)?.name).toBe('workspace-one');
    });
  });

  describe('listRegisteredWorkspaces', () => {
    it('returns empty array when no registry exists', () => {
      const workspaces = listRegisteredWorkspaces();
      expect(workspaces).toEqual([]);
    });

    it('marks active workspace', () => {
      registerWorkspace(tmpWs1, 'workspace-one');
      registerWorkspace(tmpWs2, 'workspace-two');

      const workspaces = listRegisteredWorkspaces(tmpWs1);
      const active = workspaces.find((w) => w.active);
      expect(active?.path).toBe(tmpWs1);
    });

    it('reads sources from workspace config', () => {
      registerWorkspace(tmpWs2, 'workspace-two');

      const workspaces = listRegisteredWorkspaces();
      expect(workspaces.at(0)?.sources).toContain('jira');
    });

    it('auto-prunes dead workspaces', () => {
      registerWorkspace(tmpWs1, 'workspace-one');
      registerWorkspace(tmpWs2, 'workspace-two');

      rmSync(tmpWs1, { recursive: true, force: true });

      const workspaces = listRegisteredWorkspaces();
      expect(workspaces).toHaveLength(1);
      expect(workspaces.at(0)?.path).toBe(tmpWs2);
    });
  });

  describe('pruneDeadWorkspaces', () => {
    it('removes entries for deleted workspaces', () => {
      registerWorkspace(tmpWs1, 'workspace-one');
      registerWorkspace(tmpWs2, 'workspace-two');

      rmSync(tmpWs1, { recursive: true, force: true });
      rmSync(tmpWs2, { recursive: true, force: true });

      pruneDeadWorkspaces();

      const workspaces = listRegisteredWorkspaces();
      expect(workspaces).toEqual([]);
    });

    it('keeps live workspaces', () => {
      registerWorkspace(tmpWs1, 'workspace-one');
      registerWorkspace(tmpWs2, 'workspace-two');

      rmSync(tmpWs1, { recursive: true, force: true });

      pruneDeadWorkspaces();

      const workspaces = listRegisteredWorkspaces();
      expect(workspaces).toHaveLength(1);
      expect(workspaces.at(0)?.path).toBe(tmpWs2);
    });
  });
});
