/**
 * Unit tests for registerStatusCommand.
 *
 * The status action now reads from the hub store and queries hub
 * Postgres directly. We mock the hub bindings at module boundaries so
 * the test exercises command wiring without doing real I/O.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(() => Buffer.from('')),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => false),
}));

vi.mock('../../../src/workspace/hub-config.js', () => ({
  loadHubConfig: vi.fn(() => ({
    hubDir: '/tmp/hub',
    db: { host: 'h', port: 5434, user: 'u', password: 'p', database: 'd' },
  })),
  hubDir: vi.fn(() => '/tmp/hub'),
}));

vi.mock('../../../src/workspace/active-workspace.js', () => ({
  getActiveWorkspaceId: vi.fn(() => null),
}));

vi.mock('../../../src/cli/workspace/shared.js', () => ({
  openHubStore: vi.fn().mockResolvedValue({
    store: {
      list: vi.fn().mockResolvedValue([]),
      getById: vi.fn().mockResolvedValue(null),
      getByName: vi.fn().mockResolvedValue(null),
    },
    close: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('chalk', () => {
  const identity = (s: string): string => s;
  const tagged = Object.assign(identity, {
    red: identity, green: identity, yellow: identity,
    blue: identity, dim: identity, bold: identity, cyan: identity,
  });
  return { default: tagged };
});

import { registerStatusCommand } from '../../../src/cli/status.js';
import type { Command } from 'commander';
import type { MockInstance } from 'vitest';

type ActionFn = (opts: { workspace?: string }) => Promise<void>;

interface FakeCommand {
  command: ReturnType<typeof vi.fn>;
  description: ReturnType<typeof vi.fn>;
  option: ReturnType<typeof vi.fn>;
  action: ReturnType<typeof vi.fn>;
}

function makeFakeProgram(): FakeCommand {
  const fake: FakeCommand = {
    command: vi.fn(),
    description: vi.fn(),
    option: vi.fn(),
    action: vi.fn(),
  };
  fake.command.mockReturnValue(fake);
  fake.description.mockReturnValue(fake);
  fake.option.mockReturnValue(fake);
  fake.action.mockReturnValue(fake);
  return fake;
}

describe('registerStatusCommand', () => {
  let program: FakeCommand;
  let consoleLogSpy: MockInstance<typeof console.log>;

  beforeEach(() => {
    vi.clearAllMocks();
    program = makeFakeProgram();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => { /* suppress */ });
  });

  it('registers the "status" subcommand', () => {
    registerStatusCommand(program as unknown as Command);

    expect(program.command).toHaveBeenCalledWith('status');
    expect(program.action).toHaveBeenCalledOnce();
    consoleLogSpy.mockRestore();
  });

  it('runs the action without throwing when there are no workspaces', async () => {
    registerStatusCommand(program as unknown as Command);
    const action = program.action.mock.calls[0]?.[0] as ActionFn | undefined;
    if (action === undefined) {throw new Error('action not registered');}

    await expect(action({})).resolves.toBeUndefined();
    consoleLogSpy.mockRestore();
  });
});
