/**
 * Unit tests for the sync CLI command registration.
 *
 * After the hub refactor, `sync` no longer exposes init-helper functions
 * (`syncJiraFromInit`, etc.) — they were inlined into `registerSyncCommand`
 * which resolves the workspace through the hub store. These tests cover
 * the surviving public surface: `registerSyncCommand` wiring.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/workspace/hub-config.js', () => ({
  loadHubConfig: vi.fn(() => ({
    hubDir: '/tmp/hub',
    db: { host: 'localhost', port: 5434, user: 'u', password: 'p', database: 'd' },
    credentials: {},
  })),
}));

vi.mock('../../../src/cli/add/shared.js', () => ({
  openHubStore: vi.fn().mockResolvedValue({
    store: {
      getById: vi.fn().mockResolvedValue(null),
      getByName: vi.fn().mockResolvedValue(null),
      list: vi.fn().mockResolvedValue([]),
      touchActive: vi.fn().mockResolvedValue(undefined),
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

import { registerSyncCommand } from '../../../src/cli/sync.js';
import type { Command } from 'commander';

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

describe('registerSyncCommand', () => {
  let fakeProgram: FakeCommand;

  beforeEach(() => {
    vi.clearAllMocks();
    fakeProgram = makeFakeProgram();
  });

  it('registers the "sync [type]" subcommand on the program', () => {
    registerSyncCommand(fakeProgram as unknown as Command);

    expect(fakeProgram.command).toHaveBeenCalledWith('sync [type]');
    expect(fakeProgram.description).toHaveBeenCalledOnce();
  });

  it('declares the --workspace, --project, --since, --file options', () => {
    registerSyncCommand(fakeProgram as unknown as Command);

    const optionCalls: unknown[] = (fakeProgram.option.mock.calls as unknown[][]).map((c) => c[0]);
    expect(optionCalls).toContainEqual(expect.stringContaining('--workspace'));
    expect(optionCalls).toContainEqual(expect.stringContaining('--project'));
    expect(optionCalls).toContainEqual(expect.stringContaining('--since'));
    expect(optionCalls).toContainEqual(expect.stringContaining('--file'));
  });

  it('registers an async action handler', () => {
    registerSyncCommand(fakeProgram as unknown as Command);

    expect(fakeProgram.action).toHaveBeenCalledOnce();
    const handler = fakeProgram.action.mock.calls[0]?.[0] as unknown;
    expect(typeof handler).toBe('function');
  });
});
