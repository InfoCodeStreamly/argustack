/**
 * Unit tests for registerMigrateCommand — `argustack migrate-to-hub`.
 * We mock the legacy registry, hub config, postgres adapter, and the
 * use-case so the test focuses on flag parsing, summary printing, and
 * the no-legacy short-circuit.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Command } from 'commander';

vi.mock('../../../src/workspace/hub-config.js', () => ({
  loadHubConfig: vi.fn().mockReturnValue({
    db: { host: 'h', port: 5432, user: 'u', password: 'p', database: 'd' },
  }),
  hubDir: vi.fn(() => '/tmp/hub'),
}));

vi.mock('../../../src/workspace/registry.js', () => ({
  listLegacyWorkspaces: vi.fn(),
}));

vi.mock('../../../src/adapters/postgres/index.js', () => ({
  createPool: vi.fn(() => ({ end: vi.fn().mockResolvedValue(undefined) })),
  PostgresWorkspaceStore: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this['initialize'] = vi.fn().mockResolvedValue(undefined);
  }),
}));

const executeMock = vi.fn();
vi.mock('../../../src/cli/migrate-to-hub-impl.js', () => ({
  MigrateToHubUseCase: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this['execute'] = executeMock;
  }),
}));

vi.mock('node:fs', () => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(true),
}));

vi.mock('chalk', () => {
  const id = (s: string): string => s;
  return { default: Object.assign(id, { green: id, dim: id, red: id, yellow: id, bold: id }) };
});

import { registerMigrateCommand } from '../../../src/cli/migrate-to-hub.js';
import { listLegacyWorkspaces } from '../../../src/workspace/registry.js';

interface FakeProgram {
  command: ReturnType<typeof vi.fn>;
  description: ReturnType<typeof vi.fn>;
  option: ReturnType<typeof vi.fn>;
  action: ReturnType<typeof vi.fn>;
}

function makeFakeProgram(): FakeProgram {
  const fake: FakeProgram = {
    command: vi.fn(), description: vi.fn(), option: vi.fn(), action: vi.fn(),
  };
  fake.command.mockReturnValue(fake); fake.description.mockReturnValue(fake);
  fake.option.mockReturnValue(fake); fake.action.mockReturnValue(fake);
  return fake;
}

interface MigrateOpts {
  dryRun?: boolean;
  keepLegacy?: boolean;
  allowConflicts?: boolean;
  rename?: string[];
}
type ActionFn = (opts: MigrateOpts) => Promise<void>;

beforeEach(() => {
  vi.clearAllMocks();
  executeMock.mockResolvedValue({ migrated: [], skipped: [], mismatches: [] });
});

describe('registerMigrateCommand', () => {
  it('registers the migrate-to-hub command', () => {
    const program = makeFakeProgram();
    registerMigrateCommand(program as unknown as Command);
    expect(program.command).toHaveBeenCalledWith('migrate-to-hub');
  });

  it('short-circuits when no legacy workspaces exist', async () => {
    vi.mocked(listLegacyWorkspaces).mockReturnValue([]);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { /* suppress */ });
    const program = makeFakeProgram();
    registerMigrateCommand(program as unknown as Command);
    const action = program.action.mock.calls[0]?.[0] as ActionFn | undefined;
    if (action === undefined) { throw new Error('no action'); }

    try {
      await action({});
    } finally {
      consoleSpy.mockRestore();
    }

    expect(executeMock).not.toHaveBeenCalled();
  });

  it('passes --dry-run and --rename flags into the use case', async () => {
    vi.mocked(listLegacyWorkspaces).mockReturnValue([
      { name: 'My Workspace', path: '/tmp/old', sources: [], active: false },
    ]);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { /* suppress */ });
    const program = makeFakeProgram();
    registerMigrateCommand(program as unknown as Command);
    const action = program.action.mock.calls[0]?.[0] as ActionFn | undefined;
    if (action === undefined) { throw new Error('no action'); }

    try {
      await action({ dryRun: true, rename: ['my-workspace=fresh'] });
    } finally {
      consoleSpy.mockRestore();
    }

    expect(executeMock).toHaveBeenCalled();
    const [, options] = executeMock.mock.calls[0] as [unknown, { dryRun?: boolean; rename: Record<string, string> }];
    expect(options.dryRun).toBe(true);
    expect(options.rename).toEqual({ 'my-workspace': 'fresh' });
  });

  it('prints summary including migrated and skipped workspaces', async () => {
    vi.mocked(listLegacyWorkspaces).mockReturnValue([
      { name: 'ws', path: '/tmp/ws', sources: [], active: false },
    ]);
    executeMock.mockResolvedValue({
      migrated: ['ws'],
      skipped: ['other'],
      mismatches: [{ workspaceId: 'ws', mismatches: [{ table: 'issues', legacy: 5, hub: 4 }] }],
    });

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { /* suppress */ });
    const program = makeFakeProgram();
    registerMigrateCommand(program as unknown as Command);
    const action = program.action.mock.calls[0]?.[0] as ActionFn | undefined;
    if (action === undefined) { throw new Error('no action'); }

    let messages: string;
    try {
      await action({});
      messages = consoleSpy.mock.calls.flat().map(String).join(' ');
    } finally {
      consoleSpy.mockRestore();
    }

    expect(messages).toContain('migrated:');
    expect(messages).toContain('skipped:');
    expect(messages).toContain('count mismatches');
  });

  it('writes a log file when the use case emits progress', async () => {
    vi.mocked(listLegacyWorkspaces).mockReturnValue([
      { name: 'ws', path: '/tmp/ws', sources: [], active: false },
    ]);
    executeMock.mockImplementation(async (_targets: unknown, opts: { onProgress: (m: string) => void }) => {
      opts.onProgress('line 1');
      opts.onProgress('line 2');
      return Promise.resolve({ migrated: [], skipped: [], mismatches: [] });
    });

    const fs = await import('node:fs');
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { /* suppress */ });
    const program = makeFakeProgram();
    registerMigrateCommand(program as unknown as Command);
    const action = program.action.mock.calls[0]?.[0] as ActionFn | undefined;
    if (action === undefined) { throw new Error('no action'); }

    try {
      await action({});
    } finally {
      consoleSpy.mockRestore();
    }

    expect(fs.writeFileSync).toHaveBeenCalled();
    const written = vi.mocked(fs.writeFileSync).mock.calls[0]?.[1] as string;
    expect(written).toContain('line 1');
    expect(written).toContain('line 2');
  });
});
