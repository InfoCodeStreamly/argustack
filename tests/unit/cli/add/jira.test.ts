/**
 * Unit tests for registerJiraCommand — `argustack add jira`.
 * Parses CSV project keys, conditionally upserts credentials into
 * config.env, and binds the project list to the workspace.
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

import { registerJiraCommand } from '../../../../src/cli/add/jira.js';
import {
  openHubStore,
  appendToListSetting,
  upsertHubEnv,
} from '../../../../src/cli/add/shared.js';

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

interface JiraOpts {
  workspace?: string;
  url?: string;
  email?: string;
  token?: string;
  projects?: string;
}
type ActionFn = (opts: JiraOpts) => Promise<void>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(openHubStore).mockResolvedValue({
    store: {} as never,
    close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  });
});

describe('registerJiraCommand', () => {
  it('registers a "jira" subcommand', () => {
    const { group } = makeFakeGroup();
    registerJiraCommand(group as unknown as Command);
    expect(group.command).toHaveBeenCalledWith('jira');
  });

  it('throws when --projects is missing', async () => {
    const { group, sub } = makeFakeGroup();
    registerJiraCommand(group as unknown as Command);
    const action = sub.action.mock.calls[0]?.[0] as ActionFn | undefined;
    if (action === undefined) { throw new Error('no action'); }

    await expect(action({})).rejects.toThrow(/--projects is required/);
  });

  it('throws when --projects parses to an empty list', async () => {
    const { group, sub } = makeFakeGroup();
    registerJiraCommand(group as unknown as Command);
    const action = sub.action.mock.calls[0]?.[0] as ActionFn | undefined;
    if (action === undefined) { throw new Error('no action'); }

    await expect(action({ projects: ' , , ' })).rejects.toThrow(/at least one project key/);
  });

  it('splits comma-separated projects and trims whitespace', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { /* suppress */ });
    const { group, sub } = makeFakeGroup();
    registerJiraCommand(group as unknown as Command);
    const action = sub.action.mock.calls[0]?.[0] as ActionFn | undefined;
    if (action === undefined) { throw new Error('no action'); }

    try {
      await action({ projects: 'ARG, PAP ,FOO' });
    } finally {
      consoleSpy.mockRestore();
    }

    expect(appendToListSetting).toHaveBeenCalledWith(
      expect.anything(),
      'ws-1',
      'jiraProjectKeys',
      ['ARG', 'PAP', 'FOO'],
    );
  });

  it('upserts only the credentials supplied via flags', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { /* suppress */ });
    const { group, sub } = makeFakeGroup();
    registerJiraCommand(group as unknown as Command);
    const action = sub.action.mock.calls[0]?.[0] as ActionFn | undefined;
    if (action === undefined) { throw new Error('no action'); }

    try {
      await action({
        projects: 'ARG',
        url: 'https://x.atlassian.net',
        token: 'tok',
      });
    } finally {
      consoleSpy.mockRestore();
    }

    expect(upsertHubEnv).toHaveBeenCalledWith({
      JIRA_URL: 'https://x.atlassian.net',
      JIRA_API_TOKEN: 'tok',
    });
  });

  it('does not call upsertHubEnv when no credentials supplied', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { /* suppress */ });
    const { group, sub } = makeFakeGroup();
    registerJiraCommand(group as unknown as Command);
    const action = sub.action.mock.calls[0]?.[0] as ActionFn | undefined;
    if (action === undefined) { throw new Error('no action'); }

    try {
      await action({ projects: 'ARG' });
    } finally {
      consoleSpy.mockRestore();
    }

    expect(upsertHubEnv).not.toHaveBeenCalled();
  });
});
