/**
 * Unit tests for registerSourceCommands.
 *
 * After the hub refactor, the `source` group exposes only `source list`,
 * which inspects bindings on a hub-managed workspace. Add/enable/disable
 * moved into `argustack add`. These tests cover the surviving surface.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Workspace } from '../../../src/core/types/index.js';

vi.mock('../../../src/cli/add/shared.js', () => ({
  openHubStore: vi.fn().mockResolvedValue({
    store: {
      getById: vi.fn().mockResolvedValue(null),
      getByName: vi.fn().mockResolvedValue(null),
      list: vi.fn().mockResolvedValue([]),
    },
    close: vi.fn().mockResolvedValue(undefined),
  }),
  resolveWorkspaceFlag: vi.fn().mockResolvedValue('ws-test'),
}));

vi.mock('chalk', () => {
  const identity = (s: string): string => s;
  const tagged = Object.assign(identity, {
    red: identity, green: identity, yellow: identity,
    blue: identity, dim: identity, bold: identity, cyan: identity,
  });
  return { default: tagged };
});

import { registerSourceCommands } from '../../../src/cli/sources.js';
import { openHubStore, resolveWorkspaceFlag } from '../../../src/cli/add/shared.js';
import type { Command } from 'commander';

interface FakeSubCommand {
  description: ReturnType<typeof vi.fn>;
  option: ReturnType<typeof vi.fn>;
  action: ReturnType<typeof vi.fn>;
  command: ReturnType<typeof vi.fn>;
}

function makeFakeSub(): FakeSubCommand {
  const sub: FakeSubCommand = {
    description: vi.fn(),
    option: vi.fn(),
    action: vi.fn(),
    command: vi.fn(),
  };
  sub.description.mockReturnValue(sub);
  sub.option.mockReturnValue(sub);
  sub.action.mockReturnValue(sub);
  sub.command.mockReturnValue(sub);
  return sub;
}

describe('registerSourceCommands', () => {
  let program: FakeSubCommand;
  let sourceCmd: FakeSubCommand;

  beforeEach(() => {
    vi.clearAllMocks();
    sourceCmd = makeFakeSub();
    program = makeFakeSub();
    program.command.mockReturnValue(sourceCmd);
  });

  it('registers the "source" group with a "list" subcommand', () => {
    registerSourceCommands(program as unknown as Command);

    expect(program.command).toHaveBeenCalledWith('source');
    expect(sourceCmd.command).toHaveBeenCalledWith('list');
  });

  it('list subcommand fetches the workspace via openHubStore and resolveWorkspaceFlag', async () => {
    const workspace: Workspace = {
      id: 'ws-test',
      name: 'Test',
      settings: { jiraProjectKeys: ['PROJ'] },
    };
    const closeFn = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    vi.mocked(openHubStore).mockResolvedValue({
      store: {
        name: 'fake',
        initialize: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
        create: vi.fn<(w: Workspace) => Promise<Workspace>>().mockResolvedValue(workspace),
        getById: vi.fn().mockResolvedValue(workspace),
        getByName: vi.fn().mockResolvedValue(workspace),
        list: vi.fn().mockResolvedValue([workspace]),
        updateSettings: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
        remove: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
        touchActive: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
        close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      },
      close: closeFn,
    });
    vi.mocked(resolveWorkspaceFlag).mockResolvedValue('ws-test');

    registerSourceCommands(program as unknown as Command);
    const action = sourceCmd.action.mock.calls[0]?.[0] as ((opts: Record<string, unknown>) => Promise<void>) | undefined;
    if (action === undefined) {throw new Error('action not registered');}

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { /* suppress */ });
    try {
      await action({});
    } finally {
      consoleSpy.mockRestore();
    }

    expect(resolveWorkspaceFlag).toHaveBeenCalled();
    expect(closeFn).toHaveBeenCalled();
  });
});
