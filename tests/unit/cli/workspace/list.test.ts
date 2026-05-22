/**
 * Unit tests for registerListCommand — `argustack workspace list`.
 * Shows the hub workspace list with active marker.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Command } from 'commander';
import type { Workspace } from '../../../../src/core/types/index.js';

vi.mock('../../../../src/cli/workspace/shared.js', () => ({
  openHubStore: vi.fn(),
}));

vi.mock('../../../../src/workspace/active-workspace.js', () => ({
  getActiveWorkspaceId: vi.fn(),
}));

vi.mock('chalk', () => {
  const id = (s: string): string => s;
  const tagged = Object.assign(id, {
    green: Object.assign(id, { bold: id }),
    dim: id, red: id, yellow: id, bold: id,
  });
  return { default: tagged };
});

import { registerListCommand } from '../../../../src/cli/workspace/list.js';
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

type ActionFn = () => Promise<void>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('registerListCommand', () => {
  it('registers a "list" subcommand', () => {
    const { group } = makeFakeGroup();
    registerListCommand(group as unknown as Command);
    expect(group.command).toHaveBeenCalledWith('list');
  });

  it('prints an empty-list hint when no workspaces exist', async () => {
    const list = vi.fn().mockResolvedValue([] as Workspace[]);
    vi.mocked(openHubStore).mockResolvedValue({
      store: { list } as never,
      close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    });
    vi.mocked(getActiveWorkspaceId).mockReturnValue(null);

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { /* suppress */ });
    const { group, sub } = makeFakeGroup();
    registerListCommand(group as unknown as Command);
    const action = sub.action.mock.calls[0]?.[0] as ActionFn | undefined;
    if (action === undefined) { throw new Error('no action'); }

    let messages: string;
    try {
      await action();
      messages = consoleSpy.mock.calls.flat().map(String).join(' ');
    } finally {
      consoleSpy.mockRestore();
    }

    expect(messages).toContain('No workspaces in the hub');
  });

  it('lists workspaces and marks the active one', async () => {
    const workspaces: Workspace[] = [
      { id: 'a', name: 'alpha', lastActiveAt: '2026-01-01T00:00:00Z' },
      { id: 'b', name: 'beta' },
    ];
    vi.mocked(openHubStore).mockResolvedValue({
      store: { list: vi.fn().mockResolvedValue(workspaces) } as never,
      close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    });
    vi.mocked(getActiveWorkspaceId).mockReturnValue('a');

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { /* suppress */ });
    const { group, sub } = makeFakeGroup();
    registerListCommand(group as unknown as Command);
    const action = sub.action.mock.calls[0]?.[0] as ActionFn | undefined;
    if (action === undefined) { throw new Error('no action'); }

    let messages: string;
    try {
      await action();
      messages = consoleSpy.mock.calls.flat().map(String).join(' ');
    } finally {
      consoleSpy.mockRestore();
    }

    expect(messages).toContain('alpha');
    expect(messages).toContain('beta');
    expect(messages).toContain('Workspaces (2)');
  });

  it('closes the hub store after listing', async () => {
    const closeFn = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    vi.mocked(openHubStore).mockResolvedValue({
      store: { list: vi.fn().mockResolvedValue([]) } as never,
      close: closeFn,
    });
    vi.mocked(getActiveWorkspaceId).mockReturnValue(null);

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { /* suppress */ });
    const { group, sub } = makeFakeGroup();
    registerListCommand(group as unknown as Command);
    const action = sub.action.mock.calls[0]?.[0] as ActionFn | undefined;
    if (action === undefined) { throw new Error('no action'); }

    try {
      await action();
    } finally {
      consoleSpy.mockRestore();
    }

    expect(closeFn).toHaveBeenCalled();
  });
});
