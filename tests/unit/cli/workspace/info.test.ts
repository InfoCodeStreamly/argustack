/**
 * Unit tests for registerInfoCommand — `argustack workspace info`.
 * The action dynamically imports loadHubConfig and createPool; we mock
 * both modules statically so vitest substitutes the dynamic import.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Command } from 'commander';
import type { Workspace } from '../../../../src/core/types/index.js';
import type { IWorkspaceStore } from '../../../../src/core/ports/workspace-store.js';

vi.mock('../../../../src/cli/workspace/shared.js', () => ({
  openHubStore: vi.fn(),
}));

vi.mock('../../../../src/workspace/active-workspace.js', () => ({
  getActiveWorkspaceId: vi.fn(),
}));

vi.mock('../../../../src/workspace/hub-config.js', () => ({
  loadHubConfig: vi.fn().mockReturnValue({
    db: { host: 'h', port: 5432, user: 'u', password: 'p', database: 'd' },
  }),
}));

const poolQuery = vi.fn().mockResolvedValue({ rows: [{ cnt: '0' }] });
const poolEnd = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../../src/adapters/postgres/index.js', () => ({
  createPool: vi.fn(() => ({ query: poolQuery, end: poolEnd })),
}));

vi.mock('chalk', () => {
  const id = (s: string): string => s;
  return { default: Object.assign(id, { green: id, dim: id, red: id, yellow: id, bold: id, cyan: id }) };
});

import { registerInfoCommand } from '../../../../src/cli/workspace/info.js';
import { openHubStore } from '../../../../src/cli/workspace/shared.js';
import { getActiveWorkspaceId } from '../../../../src/workspace/active-workspace.js';

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

type ActionFn = (name: string | undefined) => Promise<void>;

beforeEach(() => {
  vi.clearAllMocks();
  poolQuery.mockResolvedValue({ rows: [{ cnt: '0' }] });
});

describe('registerInfoCommand', () => {
  it('registers an "info [name]" subcommand', () => {
    const { group } = makeFakeGroup();
    registerInfoCommand(group as unknown as Command);
    expect(group.command).toHaveBeenCalledWith('info [name]');
  });

  it('throws when no name and no active workspace', async () => {
    const store = makeStore();
    vi.mocked(openHubStore).mockResolvedValue({
      store,
      close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    });
    vi.mocked(getActiveWorkspaceId).mockReturnValue(null);

    const { group, sub } = makeFakeGroup();
    registerInfoCommand(group as unknown as Command);
    const action = sub.action.mock.calls[0]?.[0] as ActionFn | undefined;
    if (action === undefined) { throw new Error('no action'); }

    await expect(action(undefined)).rejects.toThrow(/No active workspace/);
  });

  it('throws when workspace not found by id or name', async () => {
    const store = makeStore();
    vi.mocked(openHubStore).mockResolvedValue({
      store,
      close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    });

    const { group, sub } = makeFakeGroup();
    registerInfoCommand(group as unknown as Command);
    const action = sub.action.mock.calls[0]?.[0] as ActionFn | undefined;
    if (action === undefined) { throw new Error('no action'); }

    await expect(action('ghost')).rejects.toThrow(/not found/);
  });

  it('counts rows from each tenant table on the happy path', async () => {
    const ws: Workspace = { id: 'ws-1', name: 'alpha', settings: { jiraProjectKeys: ['ARG'] } };
    const store = makeStore({ getById: vi.fn().mockResolvedValue(ws) });
    vi.mocked(openHubStore).mockResolvedValue({
      store,
      close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    });

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { /* suppress */ });
    const { group, sub } = makeFakeGroup();
    registerInfoCommand(group as unknown as Command);
    const action = sub.action.mock.calls[0]?.[0] as ActionFn | undefined;
    if (action === undefined) { throw new Error('no action'); }

    try {
      await action('ws-1');
    } finally {
      consoleSpy.mockRestore();
    }

    expect(poolQuery).toHaveBeenCalled();
    expect(poolEnd).toHaveBeenCalled();
  });

  it('defaults to the active workspace when name is omitted', async () => {
    vi.mocked(getActiveWorkspaceId).mockReturnValue('active-ws');
    const ws: Workspace = { id: 'active-ws', name: 'active' };
    const getById = vi.fn().mockResolvedValue(ws);
    const store = makeStore({ getById });
    vi.mocked(openHubStore).mockResolvedValue({
      store,
      close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    });

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { /* suppress */ });
    const { group, sub } = makeFakeGroup();
    registerInfoCommand(group as unknown as Command);
    const action = sub.action.mock.calls[0]?.[0] as ActionFn | undefined;
    if (action === undefined) { throw new Error('no action'); }

    try {
      await action(undefined);
    } finally {
      consoleSpy.mockRestore();
    }

    expect(getById).toHaveBeenCalledWith('active-ws');
  });
});
