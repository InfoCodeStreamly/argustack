/**
 * Unit tests for registerAddCommand — `argustack workspace add <name>`.
 * Verifies slug sanitisation, idempotent create, --use side effect, and
 * --display-name forwarding.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Command } from 'commander';
import type { Workspace } from '../../../../src/core/types/index.js';
import type { IWorkspaceStore } from '../../../../src/core/ports/workspace-store.js';

vi.mock('../../../../src/cli/workspace/shared.js', () => ({
  openHubStore: vi.fn(),
  sanitizeSlug: vi.fn((s: string) => s.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')),
}));

vi.mock('../../../../src/workspace/active-workspace.js', () => ({
  setActiveWorkspace: vi.fn(),
}));

vi.mock('chalk', () => {
  const id = (s: string): string => s;
  return { default: Object.assign(id, { green: id, dim: id, red: id, yellow: id, bold: id }) };
});

import { registerAddCommand } from '../../../../src/cli/workspace/add.js';
import { openHubStore } from '../../../../src/cli/workspace/shared.js';
import { setActiveWorkspace } from '../../../../src/workspace/active-workspace.js';

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

type ActionFn = (name: string, opts: { use?: boolean; displayName?: string }) => Promise<void>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('registerAddCommand', () => {
  it('registers an "add <name>" subcommand', () => {
    const { group } = makeFakeGroup();
    registerAddCommand(group as unknown as Command);
    expect(group.command).toHaveBeenCalledWith('add <name>');
  });

  it('throws when name sanitises to an empty slug', async () => {
    const created: Workspace = { id: '', name: '' };
    const store = makeStore({
      create: vi.fn().mockResolvedValue(created),
    });
    vi.mocked(openHubStore).mockResolvedValue({
      store,
      close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    });

    const { group, sub } = makeFakeGroup();
    registerAddCommand(group as unknown as Command);
    const action = sub.action.mock.calls[0]?.[0] as ActionFn | undefined;
    if (action === undefined) { throw new Error('no action'); }

    await expect(action('!!!', {})).rejects.toThrow(/at least one alphanumeric/);
  });

  it('creates the workspace and prints success on the happy path', async () => {
    const created: Workspace = { id: 'my-ws', name: 'my-ws' };
    const create = vi.fn().mockResolvedValue(created);
    const store = makeStore({ create });
    const closeFn = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    vi.mocked(openHubStore).mockResolvedValue({ store, close: closeFn });

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { /* suppress */ });
    const { group, sub } = makeFakeGroup();
    registerAddCommand(group as unknown as Command);
    const action = sub.action.mock.calls[0]?.[0] as ActionFn | undefined;
    if (action === undefined) { throw new Error('no action'); }

    try {
      await action('My-WS', {});
    } finally {
      consoleSpy.mockRestore();
    }

    expect(create).toHaveBeenCalledWith({ id: 'my-ws', name: 'my-ws' });
    expect(closeFn).toHaveBeenCalled();
    expect(setActiveWorkspace).not.toHaveBeenCalled();
  });

  it('sets the workspace active when --use is passed', async () => {
    const created: Workspace = { id: 'ws-x', name: 'ws-x' };
    const touch = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const store = makeStore({ create: vi.fn().mockResolvedValue(created), touchActive: touch });
    vi.mocked(openHubStore).mockResolvedValue({
      store,
      close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    });

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { /* suppress */ });
    const { group, sub } = makeFakeGroup();
    registerAddCommand(group as unknown as Command);
    const action = sub.action.mock.calls[0]?.[0] as ActionFn | undefined;
    if (action === undefined) { throw new Error('no action'); }

    try {
      await action('ws-x', { use: true });
    } finally {
      consoleSpy.mockRestore();
    }

    expect(setActiveWorkspace).toHaveBeenCalledWith('ws-x', 'ws-x');
    expect(touch).toHaveBeenCalledWith('ws-x');
  });

  it('forwards --display-name to store.create()', async () => {
    const created: Workspace = { id: 'foo', name: 'foo', displayName: 'Foo Pretty' };
    const create = vi.fn().mockResolvedValue(created);
    const store = makeStore({ create });
    vi.mocked(openHubStore).mockResolvedValue({
      store,
      close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    });

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { /* suppress */ });
    const { group, sub } = makeFakeGroup();
    registerAddCommand(group as unknown as Command);
    const action = sub.action.mock.calls[0]?.[0] as ActionFn | undefined;
    if (action === undefined) { throw new Error('no action'); }

    try {
      await action('foo', { displayName: 'Foo Pretty' });
    } finally {
      consoleSpy.mockRestore();
    }

    expect(create).toHaveBeenCalledWith({
      id: 'foo',
      name: 'foo',
      displayName: 'Foo Pretty',
    });
  });

  it('warns (but still creates) when workspace id already exists', async () => {
    const existing: Workspace = { id: 'dup', name: 'dup' };
    const store = makeStore({
      getById: vi.fn().mockResolvedValue(existing),
      create: vi.fn().mockResolvedValue(existing),
    });
    vi.mocked(openHubStore).mockResolvedValue({
      store,
      close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    });

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { /* suppress */ });
    const { group, sub } = makeFakeGroup();
    registerAddCommand(group as unknown as Command);
    const action = sub.action.mock.calls[0]?.[0] as ActionFn | undefined;
    if (action === undefined) { throw new Error('no action'); }

    let messages: string;
    try {
      await action('dup', {});
      messages = consoleSpy.mock.calls.flat().map(String).join(' ');
    } finally {
      consoleSpy.mockRestore();
    }

    expect(messages).toContain('already exists');
  });
});
