/**
 * Unit tests for registerGitCommand — `argustack add git`.
 * Stores an absolute git repo path inside `gitRepoPaths` setting.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolve } from 'node:path';
import type { Command } from 'commander';

vi.mock('../../../../src/cli/add/shared.js', () => ({
  openHubStore: vi.fn(),
  resolveWorkspaceFlag: vi.fn().mockResolvedValue('ws-1'),
  appendToListSetting: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('chalk', () => {
  const id = (s: string): string => s;
  return { default: Object.assign(id, { green: id, dim: id, red: id, yellow: id, bold: id, cyan: id }) };
});

import { registerGitCommand } from '../../../../src/cli/add/git.js';
import { openHubStore, appendToListSetting } from '../../../../src/cli/add/shared.js';

interface FakeSub {
  command: ReturnType<typeof vi.fn>;
  description: ReturnType<typeof vi.fn>;
  option: ReturnType<typeof vi.fn>;
  requiredOption: ReturnType<typeof vi.fn>;
  action: ReturnType<typeof vi.fn>;
}

function makeFakeGroup(): { group: FakeSub; sub: FakeSub } {
  const sub: FakeSub = {
    command: vi.fn(), description: vi.fn(), option: vi.fn(), requiredOption: vi.fn(), action: vi.fn(),
  };
  sub.command.mockReturnValue(sub); sub.description.mockReturnValue(sub);
  sub.option.mockReturnValue(sub); sub.requiredOption.mockReturnValue(sub); sub.action.mockReturnValue(sub);
  const group: FakeSub = {
    command: vi.fn().mockReturnValue(sub), description: vi.fn().mockReturnValue(sub),
    option: vi.fn().mockReturnValue(sub), requiredOption: vi.fn().mockReturnValue(sub),
    action: vi.fn().mockReturnValue(sub),
  };
  return { group, sub };
}

type ActionFn = (opts: { workspace?: string; root?: string }) => Promise<void>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(openHubStore).mockResolvedValue({
    store: {} as never,
    close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  });
});

describe('registerGitCommand', () => {
  it('registers a "git" subcommand with a required --root', () => {
    const { group, sub } = makeFakeGroup();
    registerGitCommand(group as unknown as Command);
    expect(group.command).toHaveBeenCalledWith('git');
    expect(sub.requiredOption).toHaveBeenCalledWith('--root <path>', expect.any(String));
  });

  it('throws when --root is missing', async () => {
    const { group, sub } = makeFakeGroup();
    registerGitCommand(group as unknown as Command);
    const action = sub.action.mock.calls[0]?.[0] as ActionFn | undefined;
    if (action === undefined) { throw new Error('no action'); }

    await expect(action({})).rejects.toThrow(/--root is required/);
  });

  it('appends the absolute repo path to gitRepoPaths', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { /* suppress */ });
    const { group, sub } = makeFakeGroup();
    registerGitCommand(group as unknown as Command);
    const action = sub.action.mock.calls[0]?.[0] as ActionFn | undefined;
    if (action === undefined) { throw new Error('no action'); }

    try {
      await action({ root: './my-repo' });
    } finally {
      consoleSpy.mockRestore();
    }

    expect(appendToListSetting).toHaveBeenCalledWith(
      expect.anything(),
      'ws-1',
      'gitRepoPaths',
      [resolve('./my-repo')],
    );
  });

  it('closes the hub store after the handler', async () => {
    const closeFn = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    vi.mocked(openHubStore).mockResolvedValue({ store: {} as never, close: closeFn });
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { /* suppress */ });

    const { group, sub } = makeFakeGroup();
    registerGitCommand(group as unknown as Command);
    const action = sub.action.mock.calls[0]?.[0] as ActionFn | undefined;
    if (action === undefined) { throw new Error('no action'); }

    try {
      await action({ root: '/abs/repo' });
    } finally {
      consoleSpy.mockRestore();
    }

    expect(closeFn).toHaveBeenCalled();
  });
});
