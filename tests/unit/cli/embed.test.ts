/**
 * Unit tests for the registerEmbedCommand action handler.
 *
 * After the hub refactor, embed reads credentials from the hub config
 * and resolves workspace via openHubStore/resolveWorkspaceFlag. We mock
 * all hub bindings at module boundaries.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/workspace/hub-config.js', () => ({
  loadHubConfig: vi.fn(),
}));

vi.mock('../../../src/cli/add/shared.js', () => ({
  openHubStore: vi.fn().mockResolvedValue({
    store: {
      getById: vi.fn(),
      getByName: vi.fn(),
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

vi.mock('ora', () => ({
  default: vi.fn(() => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    text: '',
  })),
}));

vi.mock('../../../src/adapters/postgres/index.js', () => ({
  PostgresStorage: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this['close'] = vi.fn().mockResolvedValue(undefined);
  }),
}));

vi.mock('../../../src/adapters/openai/index.js', () => ({
  OpenAIEmbeddingProvider: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this['embed'] = vi.fn().mockResolvedValue([]);
  }),
}));

vi.mock('../../../src/use-cases/embed.js', () => ({
  EmbedUseCase: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this['execute'] = vi.fn().mockResolvedValue({ embeddedCount: 0, skippedCount: 0 });
  }),
}));

import { registerEmbedCommand } from '../../../src/cli/embed.js';
import { loadHubConfig } from '../../../src/workspace/hub-config.js';
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

interface HubShape {
  db: { host: string; port: number; user: string; password: string; database: string };
  embedding: { openaiApiKey?: string };
}

const HUB_NO_KEY: HubShape = {
  db: { host: 'h', port: 5434, user: 'u', password: 'p', database: 'd' },
  embedding: {},
};

const HUB_WITH_KEY: HubShape = {
  db: { host: 'h', port: 5434, user: 'u', password: 'p', database: 'd' },
  embedding: { openaiApiKey: 'sk-test' },
};

describe('registerEmbedCommand', () => {
  let program: FakeCommand;

  beforeEach(() => {
    vi.clearAllMocks();
    program = makeFakeProgram();
  });

  it('registers the "embed" subcommand', () => {
    registerEmbedCommand(program as unknown as Command);

    expect(program.command).toHaveBeenCalledWith('embed');
  });

  it('exits with code 1 when OPENAI_API_KEY is missing from hub config', async () => {
    vi.mocked(loadHubConfig).mockReturnValue(HUB_NO_KEY as unknown as ReturnType<typeof loadHubConfig>);

    registerEmbedCommand(program as unknown as Command);
    const action = program.action.mock.calls[0]?.[0] as ((opts: Record<string, unknown>) => Promise<void>) | undefined;
    if (action === undefined) {throw new Error('action not registered');}

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { /* suppress */ });
    try {
      await expect(action({})).rejects.toThrow('exit');
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      exitSpy.mockRestore();
      consoleSpy.mockRestore();
    }
  });

  it('runs the embedding workflow when OPENAI_API_KEY is present', async () => {
    vi.mocked(loadHubConfig).mockReturnValue(HUB_WITH_KEY as unknown as ReturnType<typeof loadHubConfig>);

    registerEmbedCommand(program as unknown as Command);
    const action = program.action.mock.calls[0]?.[0] as ((opts: Record<string, unknown>) => Promise<void>) | undefined;
    if (action === undefined) {throw new Error('action not registered');}

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { /* suppress */ });
    try {
      await expect(action({})).resolves.toBeUndefined();
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
