/**
 * Unit tests for registerDbCommand — `argustack add db`.
 * Validates engine whitelist, port parsing, optional schema field,
 * and that the DbSourceConfig is appended via shared helpers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Command } from 'commander';
import type { DbSourceConfig } from '../../../../src/core/types/index.js';

vi.mock('../../../../src/cli/add/shared.js', () => ({
  openHubStore: vi.fn(),
  resolveWorkspaceFlag: vi.fn().mockResolvedValue('ws-1'),
  appendToListSetting: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('chalk', () => {
  const id = (s: string): string => s;
  return { default: Object.assign(id, { green: id, dim: id, red: id, yellow: id, bold: id, cyan: id }) };
});

import { registerDbCommand } from '../../../../src/cli/add/db.js';
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

interface DbOpts {
  workspace?: string;
  name?: string;
  engine?: string;
  host?: string;
  port?: string;
  user?: string;
  password?: string;
  database?: string;
  schema?: string;
}
type ActionFn = (opts: DbOpts) => Promise<void>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(openHubStore).mockResolvedValue({
    store: {} as never,
    close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  });
});

describe('registerDbCommand', () => {
  it('registers a "db" subcommand', () => {
    const { group } = makeFakeGroup();
    registerDbCommand(group as unknown as Command);
    expect(group.command).toHaveBeenCalledWith('db');
  });

  it('rejects unknown engines', async () => {
    const { group, sub } = makeFakeGroup();
    registerDbCommand(group as unknown as Command);
    const action = sub.action.mock.calls[0]?.[0] as ActionFn | undefined;
    if (action === undefined) { throw new Error('no action'); }

    await expect(action({ engine: 'mongodb' })).rejects.toThrow(/Unknown engine/);
  });

  it('persists a valid DbSourceConfig with parsed port', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { /* suppress */ });
    const { group, sub } = makeFakeGroup();
    registerDbCommand(group as unknown as Command);
    const action = sub.action.mock.calls[0]?.[0] as ActionFn | undefined;
    if (action === undefined) { throw new Error('no action'); }

    try {
      await action({
        engine: 'postgresql',
        name: 'prod',
        host: 'db.local',
        port: '5432',
        user: 'app',
        password: 'secret',
        database: 'main',
        schema: 'public',
      });
    } finally {
      consoleSpy.mockRestore();
    }

    const call = vi.mocked(appendToListSetting).mock.calls[0];
    expect(call).toBeDefined();
    const configs = call?.[3] as readonly DbSourceConfig[];
    expect(configs[0]).toMatchObject({
      name: 'prod',
      engine: 'postgresql',
      host: 'db.local',
      port: 5432,
      database: 'main',
      schema: 'public',
    });
  });

  it('omits schema when not provided', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { /* suppress */ });
    const { group, sub } = makeFakeGroup();
    registerDbCommand(group as unknown as Command);
    const action = sub.action.mock.calls[0]?.[0] as ActionFn | undefined;
    if (action === undefined) { throw new Error('no action'); }

    try {
      await action({
        engine: 'mysql',
        name: 'm',
        host: 'h',
        port: '3306',
        user: 'u',
        password: 'p',
        database: 'd',
      });
    } finally {
      consoleSpy.mockRestore();
    }

    const call = vi.mocked(appendToListSetting).mock.calls[0];
    const configs = call?.[3] as readonly DbSourceConfig[];
    expect(configs[0]).not.toHaveProperty('schema');
  });

  it('defaults port to 5432 when port is omitted', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { /* suppress */ });
    const { group, sub } = makeFakeGroup();
    registerDbCommand(group as unknown as Command);
    const action = sub.action.mock.calls[0]?.[0] as ActionFn | undefined;
    if (action === undefined) { throw new Error('no action'); }

    try {
      await action({
        engine: 'postgresql',
        name: 'p',
        host: 'h',
        user: 'u',
        password: 'p',
        database: 'd',
      });
    } finally {
      consoleSpy.mockRestore();
    }

    const call = vi.mocked(appendToListSetting).mock.calls[0];
    const configs = call?.[3] as readonly DbSourceConfig[];
    expect(configs[0]?.port).toBe(5432);
  });
});
