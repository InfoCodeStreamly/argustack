/**
 * Unit tests for registerCsvCommand — binds a Jira CSV export
 * to a workspace via appendToListSetting('csvFilePaths', ...).
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

import { registerCsvCommand } from '../../../../src/cli/add/csv.js';
import { openHubStore, appendToListSetting, resolveWorkspaceFlag } from '../../../../src/cli/add/shared.js';

interface FakeSub {
  command: ReturnType<typeof vi.fn>;
  description: ReturnType<typeof vi.fn>;
  option: ReturnType<typeof vi.fn>;
  requiredOption: ReturnType<typeof vi.fn>;
  action: ReturnType<typeof vi.fn>;
}

function makeFakeGroup(): { group: FakeSub; sub: FakeSub } {
  const sub: FakeSub = {
    command: vi.fn(),
    description: vi.fn(),
    option: vi.fn(),
    requiredOption: vi.fn(),
    action: vi.fn(),
  };
  sub.command.mockReturnValue(sub);
  sub.description.mockReturnValue(sub);
  sub.option.mockReturnValue(sub);
  sub.requiredOption.mockReturnValue(sub);
  sub.action.mockReturnValue(sub);
  const group: FakeSub = {
    command: vi.fn().mockReturnValue(sub),
    description: vi.fn().mockReturnValue(sub),
    option: vi.fn().mockReturnValue(sub),
    requiredOption: vi.fn().mockReturnValue(sub),
    action: vi.fn().mockReturnValue(sub),
  };
  return { group, sub };
}

type ActionFn = (opts: { workspace?: string; file?: string }) => Promise<void>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(openHubStore).mockResolvedValue({
    store: {} as never,
    close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  });
  vi.mocked(resolveWorkspaceFlag).mockResolvedValue('ws-1');
});

describe('registerCsvCommand', () => {
  it('registers a "csv" subcommand with --file as required option', () => {
    const { group, sub } = makeFakeGroup();
    registerCsvCommand(group as unknown as Command);
    expect(group.command).toHaveBeenCalledWith('csv');
    expect(sub.requiredOption).toHaveBeenCalledWith('--file <path>', expect.any(String));
  });

  it('throws when --file is missing', async () => {
    const { group, sub } = makeFakeGroup();
    registerCsvCommand(group as unknown as Command);
    const action = sub.action.mock.calls[0]?.[0] as ActionFn | undefined;
    if (action === undefined) { throw new Error('no action'); }

    await expect(action({})).rejects.toThrow(/--file is required/);
  });

  it('appends absolute path of the CSV file to the workspace settings', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { /* suppress */ });
    const { group, sub } = makeFakeGroup();
    registerCsvCommand(group as unknown as Command);
    const action = sub.action.mock.calls[0]?.[0] as ActionFn | undefined;
    if (action === undefined) { throw new Error('no action'); }

    try {
      await action({ file: './my.csv', workspace: 'ws-1' });
    } finally {
      consoleSpy.mockRestore();
    }

    expect(appendToListSetting).toHaveBeenCalledWith(
      expect.anything(),
      'ws-1',
      'csvFilePaths',
      [{ path: resolve('./my.csv') }],
    );
  });

  it('closes the hub store even when append fails', async () => {
    const closeFn = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    vi.mocked(openHubStore).mockResolvedValue({ store: {} as never, close: closeFn });
    vi.mocked(appendToListSetting).mockRejectedValueOnce(new Error('boom'));

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { /* suppress */ });
    const { group, sub } = makeFakeGroup();
    registerCsvCommand(group as unknown as Command);
    const action = sub.action.mock.calls[0]?.[0] as ActionFn | undefined;
    if (action === undefined) { throw new Error('no action'); }

    try {
      await expect(action({ file: './x.csv' })).rejects.toThrow(/boom/);
    } finally {
      consoleSpy.mockRestore();
    }

    expect(closeFn).toHaveBeenCalled();
  });
});
