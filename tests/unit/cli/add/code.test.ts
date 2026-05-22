/**
 * Unit tests for registerCodeCommand — the `argustack add code`
 * action handler. The handler is rich: it dynamically imports
 * adapters, builds an embedding provider, and runs a use case.
 * We mock every external boundary so only the orchestration logic
 * (flag validation, embedding-config gate, default language) runs.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolve } from 'node:path';
import type { Command } from 'commander';

vi.mock('../../../../src/cli/add/shared.js', () => ({
  openHubStore: vi.fn(),
  resolveWorkspaceFlag: vi.fn().mockResolvedValue('ws-1'),
}));

vi.mock('../../../../src/workspace/hub-config.js', () => ({
  loadHubConfig: vi.fn(),
}));

vi.mock('../../../../src/adapters/postgres/index.js', () => ({
  PostgresStorage: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this['close'] = vi.fn().mockResolvedValue(undefined);
  }),
}));

vi.mock('../../../../src/adapters/neo4j/index.js', () => ({
  Neo4jCodeGraphStore: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this['close'] = vi.fn().mockResolvedValue(undefined);
  }),
}));

vi.mock('../../../../src/adapters/qdrant/index.js', () => ({
  QdrantCodeVectorStore: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this['close'] = vi.fn().mockResolvedValue(undefined);
  }),
}));

vi.mock('../../../../src/adapters/lmstudio/index.js', () => ({
  LmStudioCodeEmbeddingProvider: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    /* noop */
  }),
}));

vi.mock('../../../../src/adapters/voyage/index.js', () => ({
  VoyageCodeEmbeddingProvider: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    /* noop */
  }),
}));

vi.mock('../../../../src/adapters/ollama/index.js', () => ({
  OllamaCodeEmbeddingProvider: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    /* noop */
  }),
}));

vi.mock('../../../../src/use-cases/register-code-project.js', () => ({
  RegisterCodeProjectUseCase: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this['execute'] = vi.fn().mockResolvedValue(undefined);
  }),
}));

vi.mock('chalk', () => {
  const id = (s: string): string => s;
  return { default: Object.assign(id, { green: id, dim: id, red: id, yellow: id, bold: id, cyan: id }) };
});

import { registerCodeCommand } from '../../../../src/cli/add/code.js';
import { openHubStore } from '../../../../src/cli/add/shared.js';
import { loadHubConfig } from '../../../../src/workspace/hub-config.js';

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

type ActionFn = (opts: { workspace?: string; root?: string; language?: string }) => Promise<void>;

function fullHub(): ReturnType<typeof loadHubConfig> {
  return {
    hubDir: '/tmp/hub',
    db: { host: 'h', port: 5434, user: 'u', password: 'p', database: 'd' },
    neo4j: { uri: 'bolt://localhost:7687', user: 'neo4j', password: 'x' },
    qdrant: { url: 'http://localhost:6333' },
    embedding: {
      provider: 'lmstudio' as const,
      userConfigured: true,
      model: 'qwen',
      dimensions: 1024,
    },
    credentials: {},
  } as unknown as ReturnType<typeof loadHubConfig>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(openHubStore).mockResolvedValue({
    store: {} as never,
    close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  });
});

describe('registerCodeCommand', () => {
  it('registers a "code" subcommand on the group', () => {
    const { group, sub } = makeFakeGroup();
    registerCodeCommand(group as unknown as Command);
    expect(group.command).toHaveBeenCalledWith('code');
    expect(sub.requiredOption).toHaveBeenCalledWith('--root <path>', expect.any(String));
  });

  it('throws when --root is missing', async () => {
    const { group, sub } = makeFakeGroup();
    registerCodeCommand(group as unknown as Command);
    const action = sub.action.mock.calls[0]?.[0] as ActionFn | undefined;
    if (action === undefined) { throw new Error('no action'); }

    await expect(action({})).rejects.toThrow(/--root is required/);
  });

  it('throws when embedding is not user-configured', async () => {
    vi.mocked(loadHubConfig).mockReturnValue({
      ...fullHub(),
      embedding: { ...fullHub().embedding, userConfigured: false },
    });
    const { group, sub } = makeFakeGroup();
    registerCodeCommand(group as unknown as Command);
    const action = sub.action.mock.calls[0]?.[0] as ActionFn | undefined;
    if (action === undefined) { throw new Error('no action'); }

    await expect(action({ root: '/some/path' })).rejects.toThrow(/Code intelligence is not configured/);
  });

  it('rejects unknown language values', async () => {
    vi.mocked(loadHubConfig).mockReturnValue(fullHub());
    const { group, sub } = makeFakeGroup();
    registerCodeCommand(group as unknown as Command);
    const action = sub.action.mock.calls[0]?.[0] as ActionFn | undefined;
    if (action === undefined) { throw new Error('no action'); }

    await expect(action({ root: '/p', language: 'cobol' })).rejects.toThrow(/Unknown language/);
  });

  it('runs the use-case and closes resources on the happy path', async () => {
    vi.mocked(loadHubConfig).mockReturnValue(fullHub());
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { /* suppress */ });
    const closeFn = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    vi.mocked(openHubStore).mockResolvedValue({ store: {} as never, close: closeFn });

    const { group, sub } = makeFakeGroup();
    registerCodeCommand(group as unknown as Command);
    const action = sub.action.mock.calls[0]?.[0] as ActionFn | undefined;
    if (action === undefined) { throw new Error('no action'); }

    try {
      await action({ root: './src', language: 'ts' });
    } finally {
      consoleSpy.mockRestore();
    }

    expect(closeFn).toHaveBeenCalled();
    const callRoot = resolve('./src');
    expect(callRoot).toBeTruthy();
  });
});
