/**
 * Unit tests for registerUseCommand — `argustack workspace use <name>`.
 * Sets the active workspace and updates last_active_at.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Command } from 'commander';
import type { Workspace } from '../../../../src/core/types/index.js';
import type { IWorkspaceStore } from '../../../../src/core/ports/workspace-store.js';

vi.mock('../../../../src/cli/workspace/shared.js', () => ({
  openHubStore: vi.fn(),
}));

vi.mock('../../../../src/workspace/active-workspace.js', () => ({
  setActiveWorkspace: vi.fn(),
}));

vi.mock('chalk', () => {
  const id = (s: string): string => s;
  return { default: Object.assign(id, { green: id, dim: id, red: id, yellow: id, bold: id }) };
});

import { registerUseCommand } from '../../../../src/cli/workspace/use.js';
import { openHubStore } from '../../../../src/cli/workspace/shared.js';
import { setActiveWorkspace } from '../../../../src/workspace/active-workspace.js';

interface FakeSub {
  command: ReturnType<typeof vi.fn>;
  description: ReturnType<typeof vi.fn>;
  action: ReturnType<typeof vi.fn>;
}

function makeFakeGroup(): { group: FakeSub; sub: FakeSub } {
  const sub: FakeSub = { command: vi.fn(), description: vi.fn(), action: vi.fn() };
  sub.command.mockReturnValue(sub); sub.description.mockReturnValue(sub); sub.action.mockReturnValue(sub);
  const group: FakeSub = {
    command: vi.fn().mockReturnValue(sub), description: vi.fn().mockReturnValue(sub),
    action: vi.fn().mockReturnValue(sub),
  };
  return { group, sub };
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

type ActionFn = (name: string) => Promise<void>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('registerUseCommand', () => {
  it('registers a "use <name>" subcommand', () => {
    const { group } = makeFakeGroup();
    registerUseCommand(group as unknown as Command);
    expect(group.command).toHaveBeenCalledWith('use <name>');
  });

  it('sets active workspace and touches last_active when found', async () => {
    const workspace: Workspace = { id: 'ws-1', name: 'alpha' };
    const touch = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const store = makeStore({
      getById: vi.fn().mockResolvedValue(workspace),
      touchActive: touch,
    });
    vi.mocked(openHubStore).mockResolvedValue({
      store,
      close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    });

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { /* suppress */ });
    const { group, sub } = makeFakeGroup();
    registerUseCommand(group as unknown as Command);
    const action = sub.action.mock.calls[0]?.[0] as ActionFn | undefined;
    if (action === undefined) { throw new Error('no action'); }

    try {
      await action('alpha');
    } finally {
      consoleSpy.mockRestore();
    }

    expect(setActiveWorkspace).toHaveBeenCalledWith('ws-1', 'alpha');
    expect(touch).toHaveBeenCalledWith('ws-1');
  });

  it('falls back to getByName when getById misses', async () => {
    const workspace: Workspace = { id: 'real-id', name: 'human-name' };
    const byId = vi.fn().mockResolvedValue(null);
    const byName = vi.fn().mockResolvedValue(workspace);
    const store = makeStore({ getById: byId, getByName: byName });
    vi.mocked(openHubStore).mockResolvedValue({
      store,
      close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    });

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { /* suppress */ });
    const { group, sub } = makeFakeGroup();
    registerUseCommand(group as unknown as Command);
    const action = sub.action.mock.calls[0]?.[0] as ActionFn | undefined;
    if (action === undefined) { throw new Error('no action'); }

    try {
      await action('human-name');
    } finally {
      consoleSpy.mockRestore();
    }

    expect(byName).toHaveBeenCalledWith('human-name');
    expect(setActiveWorkspace).toHaveBeenCalledWith('real-id', 'human-name');
  });

  it('throws (listing alternatives) when workspace not found', async () => {
    const store = makeStore({
      getById: vi.fn().mockResolvedValue(null),
      getByName: vi.fn().mockResolvedValue(null),
      list: vi.fn().mockResolvedValue([
        { id: 'a', name: 'alpha' },
        { id: 'b', name: 'beta' },
      ] satisfies Workspace[]),
    });
    vi.mocked(openHubStore).mockResolvedValue({
      store,
      close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    });

    const { group, sub } = makeFakeGroup();
    registerUseCommand(group as unknown as Command);
    const action = sub.action.mock.calls[0]?.[0] as ActionFn | undefined;
    if (action === undefined) { throw new Error('no action'); }

    await expect(action('ghost')).rejects.toThrow(/not found.*alpha, beta/);
  });

  it('reports "none" when no alternatives exist', async () => {
    const store = makeStore();
    vi.mocked(openHubStore).mockResolvedValue({
      store,
      close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    });

    const { group, sub } = makeFakeGroup();
    registerUseCommand(group as unknown as Command);
    const action = sub.action.mock.calls[0]?.[0] as ActionFn | undefined;
    if (action === undefined) { throw new Error('no action'); }

    await expect(action('ghost')).rejects.toThrow(/Available: none/);
  });
});
