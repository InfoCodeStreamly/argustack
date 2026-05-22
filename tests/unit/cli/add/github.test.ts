/**
 * Unit tests for registerGithubCommand — `argustack add github`.
 * Stores `owner/repo` per workspace and optionally upserts GITHUB_TOKEN
 * into the shared hub config.env.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Command } from 'commander';

vi.mock('../../../../src/cli/add/shared.js', () => ({
  openHubStore: vi.fn(),
  resolveWorkspaceFlag: vi.fn().mockResolvedValue('ws-1'),
  appendToListSetting: vi.fn().mockResolvedValue(undefined),
  upsertHubEnv: vi.fn(),
}));

vi.mock('chalk', () => {
  const id = (s: string): string => s;
  return { default: Object.assign(id, { green: id, dim: id, red: id, yellow: id, bold: id, cyan: id }) };
});

import { registerGithubCommand } from '../../../../src/cli/add/github.js';
import {
  openHubStore,
  appendToListSetting,
  upsertHubEnv,
} from '../../../../src/cli/add/shared.js';

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

type ActionFn = (opts: { workspace?: string; owner?: string; repo?: string; token?: string }) => Promise<void>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(openHubStore).mockResolvedValue({
    store: {} as never,
    close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  });
});

describe('registerGithubCommand', () => {
  it('registers a "github" subcommand with required --owner and --repo', () => {
    const { group, sub } = makeFakeGroup();
    registerGithubCommand(group as unknown as Command);
    expect(group.command).toHaveBeenCalledWith('github');
    const required = sub.requiredOption.mock.calls.map((c) => c[0] as string);
    expect(required).toEqual(expect.arrayContaining(['--owner <owner>', '--repo <repo>']));
  });

  it('throws when --owner or --repo is missing', async () => {
    const { group, sub } = makeFakeGroup();
    registerGithubCommand(group as unknown as Command);
    const action = sub.action.mock.calls[0]?.[0] as ActionFn | undefined;
    if (action === undefined) { throw new Error('no action'); }

    await expect(action({ owner: 'me' })).rejects.toThrow(/--owner and --repo are required/);
    await expect(action({ repo: 'r' })).rejects.toThrow(/--owner and --repo are required/);
  });

  it('persists the repo binding to the workspace', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { /* suppress */ });
    const { group, sub } = makeFakeGroup();
    registerGithubCommand(group as unknown as Command);
    const action = sub.action.mock.calls[0]?.[0] as ActionFn | undefined;
    if (action === undefined) { throw new Error('no action'); }

    try {
      await action({ owner: 'argustack', repo: 'cli' });
    } finally {
      consoleSpy.mockRestore();
    }

    expect(appendToListSetting).toHaveBeenCalledWith(
      expect.anything(),
      'ws-1',
      'githubRepos',
      [{ owner: 'argustack', repo: 'cli' }],
    );
  });

  it('upserts GITHUB_TOKEN into config.env when --token is supplied', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { /* suppress */ });
    const { group, sub } = makeFakeGroup();
    registerGithubCommand(group as unknown as Command);
    const action = sub.action.mock.calls[0]?.[0] as ActionFn | undefined;
    if (action === undefined) { throw new Error('no action'); }

    try {
      await action({ owner: 'o', repo: 'r', token: 'ghp_abc' });
    } finally {
      consoleSpy.mockRestore();
    }

    expect(upsertHubEnv).toHaveBeenCalledWith({ GITHUB_TOKEN: 'ghp_abc' });
  });

  it('does not upsert env when --token is empty or absent', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { /* suppress */ });
    const { group, sub } = makeFakeGroup();
    registerGithubCommand(group as unknown as Command);
    const action = sub.action.mock.calls[0]?.[0] as ActionFn | undefined;
    if (action === undefined) { throw new Error('no action'); }

    try {
      await action({ owner: 'o', repo: 'r' });
      await action({ owner: 'o', repo: 'r', token: '' });
    } finally {
      consoleSpy.mockRestore();
    }

    expect(upsertHubEnv).not.toHaveBeenCalled();
  });
});
