/**
 * Unit tests for registerRemoveCommand — `argustack workspace remove`.
 * Includes confirmation prompt, --yes bypass, and active-workspace cleanup.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Command } from 'commander';
import type { Workspace } from '../../../../src/core/types/index.js';
import type { IWorkspaceStore } from '../../../../src/core/ports/workspace-store.js';

vi.mock('../../../../src/cli/workspace/shared.js', () => ({
  openHubStore: vi.fn(),
}));

vi.mock('../../../../src/workspace/active-workspace.js', () => ({
  clearActiveWorkspace: vi.fn(),
  getActiveWorkspaceId: vi.fn(),
}));

vi.mock('@inquirer/prompts', () => ({
  confirm: vi.fn(),
}));

vi.mock('chalk', () => {
  const id = (s: string): string => s;
  return { default: Object.assign(id, { green: id, dim: id, red: id, yellow: id, bold: id }) };
});

import { registerRemoveCommand } from '../../../../src/cli/workspace/remove.js';
import { openHubStore } from '../../../../src/cli/workspace/shared.js';
import {
  clearActiveWorkspace,
  getActiveWorkspaceId,
} from '../../../../src/workspace/active-workspace.js';
import { confirm } from '@inquirer/prompts';

interface FakeSub {
  command: ReturnType<typeof vi.fn>;
  description: ReturnType<typeof vi.fn>;
  option: ReturnType<typeof vi.fn>;
  action: ReturnType<typeof vi.fn>;
}

function makeFakeGroup(): { group: FakeSub; sub: FakeSub } {
  const sub: FakeSub = {
    command: vi.fn(), description: vi.fn(), option: vi.fn(), action: vi.fn(),
  };
  sub.command.mockReturnValue(sub); sub.description.mockReturnValue(sub);
  sub.option.mockReturnValue(sub); sub.action.mockReturnValue(sub);
  const group: FakeSub = {
    command: vi.fn().mockReturnValue(sub), description: vi.fn().mockReturnValue(sub),
    option: vi.fn().mockReturnValue(sub), action: vi.fn().mockReturnValue(sub),
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

type ActionFn = (name: string, opts: { yes?: boolean }) => Promise<void>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveWorkspaceId).mockReturnValue(null);
});

describe('registerRemoveCommand', () => {
  it('registers a "remove <name>" subcommand with -y option', () => {
    const { group, sub } = makeFakeGroup();
    registerRemoveCommand(group as unknown as Command);
    expect(group.command).toHaveBeenCalledWith('remove <name>');
    expect(sub.option).toHaveBeenCalledWith('-y, --yes', expect.any(String));
  });

  it('throws when workspace not found', async () => {
    const store = makeStore({
      getById: vi.fn().mockResolvedValue(null),
      getByName: vi.fn().mockResolvedValue(null),
    });
    vi.mocked(openHubStore).mockResolvedValue({
      store,
      close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    });

    const { group, sub } = makeFakeGroup();
    registerRemoveCommand(group as unknown as Command);
    const action = sub.action.mock.calls[0]?.[0] as ActionFn | undefined;
    if (action === undefined) { throw new Error('no action'); }

    await expect(action('missing', {})).rejects.toThrow(/not found/);
  });

  it('cancels when interactive confirm returns false', async () => {
    const ws: Workspace = { id: 'a', name: 'alpha' };
    const remove = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const store = makeStore({ getById: vi.fn().mockResolvedValue(ws), remove });
    vi.mocked(openHubStore).mockResolvedValue({
      store,
      close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    });
    vi.mocked(confirm).mockResolvedValue(false);

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { /* suppress */ });
    const { group, sub } = makeFakeGroup();
    registerRemoveCommand(group as unknown as Command);
    const action = sub.action.mock.calls[0]?.[0] as ActionFn | undefined;
    if (action === undefined) { throw new Error('no action'); }

    try {
      await action('alpha', {});
    } finally {
      consoleSpy.mockRestore();
    }

    expect(remove).not.toHaveBeenCalled();
  });

  it('skips confirmation when --yes is set and removes the workspace', async () => {
    const ws: Workspace = { id: 'a', name: 'alpha' };
    const remove = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const store = makeStore({ getById: vi.fn().mockResolvedValue(ws), remove });
    vi.mocked(openHubStore).mockResolvedValue({
      store,
      close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    });

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { /* suppress */ });
    const { group, sub } = makeFakeGroup();
    registerRemoveCommand(group as unknown as Command);
    const action = sub.action.mock.calls[0]?.[0] as ActionFn | undefined;
    if (action === undefined) { throw new Error('no action'); }

    try {
      await action('alpha', { yes: true });
    } finally {
      consoleSpy.mockRestore();
    }

    expect(confirm).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith('a');
  });

  it('clears active workspace pointer when removing the currently active one', async () => {
    const ws: Workspace = { id: 'active-ws', name: 'active' };
    const store = makeStore({
      getById: vi.fn().mockResolvedValue(ws),
      remove: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    });
    vi.mocked(openHubStore).mockResolvedValue({
      store,
      close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    });
    vi.mocked(getActiveWorkspaceId).mockReturnValue('active-ws');

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { /* suppress */ });
    const { group, sub } = makeFakeGroup();
    registerRemoveCommand(group as unknown as Command);
    const action = sub.action.mock.calls[0]?.[0] as ActionFn | undefined;
    if (action === undefined) { throw new Error('no action'); }

    try {
      await action('active', { yes: true });
    } finally {
      consoleSpy.mockRestore();
    }

    expect(clearActiveWorkspace).toHaveBeenCalled();
  });
});
