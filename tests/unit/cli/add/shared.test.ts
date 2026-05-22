/**
 * Unit tests for cli/add/shared helpers — workspace resolution,
 * settings patching, list-append semantics, and config.env upsert.
 *
 * Filesystem (`node:fs`) and active-workspace lookup are mocked at the
 * module boundary so no real files or environment are touched.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Workspace, WorkspaceSettings } from '../../../../src/core/types/index.js';
import type { IWorkspaceStore } from '../../../../src/core/ports/workspace-store.js';

vi.mock('../../../../src/workspace/hub-config.js', () => ({
  loadHubConfig: vi.fn(),
  resetHubConfigCache: vi.fn(),
  hubConfigPath: vi.fn(() => '/tmp/fake-hub/config.env'),
}));

vi.mock('../../../../src/workspace/active-workspace.js', () => ({
  getActiveWorkspaceId: vi.fn(),
}));

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(),
  chmodSync: vi.fn(),
}));

import {
  resolveWorkspaceFlag,
  patchWorkspaceSetting,
  appendToListSetting,
  upsertHubEnv,
} from '../../../../src/cli/add/shared.js';
import { getActiveWorkspaceId } from '../../../../src/workspace/active-workspace.js';
import * as fs from 'node:fs';

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: overrides.id ?? 'ws-1',
    name: overrides.name ?? 'ws-1',
    ...(overrides.displayName !== undefined ? { displayName: overrides.displayName } : {}),
    ...(overrides.settings !== undefined ? { settings: overrides.settings } : {}),
  };
}

function makeStore(overrides: Partial<IWorkspaceStore> = {}): IWorkspaceStore {
  return {
    name: 'fake',
    initialize: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    create: vi.fn(),
    getById: vi.fn().mockResolvedValue(null),
    getByName: vi.fn().mockResolvedValue(null),
    list: vi.fn().mockResolvedValue([]),
    updateSettings: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    remove: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    touchActive: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    ...overrides,
  } as IWorkspaceStore;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolveWorkspaceFlag', () => {
  it('returns the explicitly-provided workspace id when found by id', async () => {
    const workspace = makeWorkspace({ id: 'ws-explicit' });
    const store = makeStore({
      getById: vi.fn().mockResolvedValue(workspace),
      getByName: vi.fn().mockResolvedValue(null),
    });

    const id = await resolveWorkspaceFlag(store, 'ws-explicit');
    expect(id).toBe('ws-explicit');
  });

  it('falls back to lookup by name when id is unknown', async () => {
    const workspace = makeWorkspace({ id: 'ws-real', name: 'human-name' });
    const store = makeStore({
      getById: vi.fn().mockResolvedValue(null),
      getByName: vi.fn().mockResolvedValue(workspace),
    });

    const id = await resolveWorkspaceFlag(store, 'human-name');
    expect(id).toBe('ws-real');
  });

  it('throws when explicit workspace cannot be found', async () => {
    const store = makeStore();

    await expect(resolveWorkspaceFlag(store, 'missing')).rejects.toThrow(
      /Workspace "missing" not found/,
    );
  });

  it('uses active workspace pointer when no flag is provided', async () => {
    vi.mocked(getActiveWorkspaceId).mockReturnValue('ws-active');
    const workspace = makeWorkspace({ id: 'ws-active' });
    const store = makeStore({
      getById: vi.fn().mockResolvedValue(workspace),
    });

    const id = await resolveWorkspaceFlag(store, undefined);
    expect(id).toBe('ws-active');
  });

  it('auto-picks the only workspace when no flag and no active pointer', async () => {
    vi.mocked(getActiveWorkspaceId).mockReturnValue(null);
    const only = makeWorkspace({ id: 'solo' });
    const store = makeStore({
      list: vi.fn().mockResolvedValue([only]),
    });

    const id = await resolveWorkspaceFlag(store, undefined);
    expect(id).toBe('solo');
  });

  it('throws when no flag, no active pointer, and multiple workspaces exist', async () => {
    vi.mocked(getActiveWorkspaceId).mockReturnValue(null);
    const store = makeStore({
      list: vi.fn().mockResolvedValue([makeWorkspace({ id: 'a' }), makeWorkspace({ id: 'b' })]),
    });

    await expect(resolveWorkspaceFlag(store, undefined)).rejects.toThrow(
      /No workspace selected/,
    );
  });

  it('treats empty string and whitespace flag like undefined', async () => {
    vi.mocked(getActiveWorkspaceId).mockReturnValue(null);
    const only = makeWorkspace({ id: 'solo' });
    const store = makeStore({
      list: vi.fn().mockResolvedValue([only]),
    });

    const id = await resolveWorkspaceFlag(store, '   ');
    expect(id).toBe('solo');
  });
});

describe('patchWorkspaceSetting', () => {
  it('calls store.updateSettings with the single key/value pair', async () => {
    const update = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const store = makeStore({ updateSettings: update });

    await patchWorkspaceSetting(store, 'ws-1', 'jiraProjectKeys', ['PROJ']);

    expect(update).toHaveBeenCalledWith('ws-1', { jiraProjectKeys: ['PROJ'] });
  });

  it('forwards arbitrary value types untouched', async () => {
    const update = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const store = makeStore({ updateSettings: update });

    await patchWorkspaceSetting(store, 'ws-2', 'gitRepoPaths', ['/tmp/a', '/tmp/b']);

    expect(update).toHaveBeenCalledWith('ws-2', { gitRepoPaths: ['/tmp/a', '/tmp/b'] });
  });
});

describe('appendToListSetting', () => {
  it('initialises an empty list when workspace has no existing setting', async () => {
    const ws = makeWorkspace({ id: 'ws-1', settings: {} });
    const update = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const store = makeStore({
      getById: vi.fn().mockResolvedValue(ws),
      updateSettings: update,
    });

    await appendToListSetting(store, 'ws-1', 'jiraProjectKeys', ['NEW']);

    expect(update).toHaveBeenCalledWith('ws-1', { jiraProjectKeys: ['NEW'] });
  });

  it('merges new values with existing ones', async () => {
    const settings: WorkspaceSettings = { jiraProjectKeys: ['EXISTING'] };
    const ws = makeWorkspace({ id: 'ws-1', settings });
    const update = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const store = makeStore({
      getById: vi.fn().mockResolvedValue(ws),
      updateSettings: update,
    });

    await appendToListSetting(store, 'ws-1', 'jiraProjectKeys', ['NEW']);

    expect(update).toHaveBeenCalledWith('ws-1', { jiraProjectKeys: ['EXISTING', 'NEW'] });
  });

  it('deduplicates by JSON signature', async () => {
    const settings: WorkspaceSettings = { jiraProjectKeys: ['DUP'] };
    const ws = makeWorkspace({ id: 'ws-1', settings });
    const update = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const store = makeStore({
      getById: vi.fn().mockResolvedValue(ws),
      updateSettings: update,
    });

    await appendToListSetting(store, 'ws-1', 'jiraProjectKeys', ['DUP', 'NEW']);

    expect(update).toHaveBeenCalledWith('ws-1', { jiraProjectKeys: ['DUP', 'NEW'] });
  });

  it('handles missing workspace gracefully (treats as empty)', async () => {
    const update = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const store = makeStore({
      getById: vi.fn().mockResolvedValue(null),
      updateSettings: update,
    });

    await appendToListSetting(store, 'absent', 'gitRepoPaths', ['/p']);

    expect(update).toHaveBeenCalledWith('absent', { gitRepoPaths: ['/p'] });
  });
});

describe('upsertHubEnv', () => {
  it('throws when hub config.env does not exist', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    expect(() => { upsertHubEnv({ JIRA_URL: 'https://x' }); }).toThrow(/Hub config not found/);
  });

  it('replaces existing keys and preserves comments / other lines', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      '# comment\nJIRA_URL=https://old\nOTHER=keep\n',
    );

    upsertHubEnv({ JIRA_URL: 'https://new' });

    expect(fs.writeFileSync).toHaveBeenCalledOnce();
    const written = vi.mocked(fs.writeFileSync).mock.calls[0]?.[1] as string;
    expect(written).toContain('JIRA_URL=https://new');
    expect(written).toContain('# comment');
    expect(written).toContain('OTHER=keep');
    expect(written).not.toContain('JIRA_URL=https://old');
  });

  it('appends new keys when not present in the existing file', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('EXISTING=1\n');

    upsertHubEnv({ GITHUB_TOKEN: 'ghp_new' });

    const written = vi.mocked(fs.writeFileSync).mock.calls[0]?.[1] as string;
    expect(written).toContain('EXISTING=1');
    expect(written).toContain('GITHUB_TOKEN=ghp_new');
  });

  it('attempts to chmod the file to 0600 (best-effort)', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('');

    upsertHubEnv({ JIRA_URL: 'https://x' });

    expect(fs.chmodSync).toHaveBeenCalledWith('/tmp/fake-hub/config.env', 0o600);
  });

  it('swallows chmod errors so write succeeds on non-POSIX systems', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('');
    vi.mocked(fs.chmodSync).mockImplementation(() => { throw new Error('EPERM'); });

    expect(() => { upsertHubEnv({ JIRA_URL: 'https://x' }); }).not.toThrow();
  });
});
