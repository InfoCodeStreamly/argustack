/**
 * Unit tests for the registerEmbedCommand action handler.
 *
 * The async action callback is extracted from Commander via a fake Command
 * stub. PostgresStorage, OpenAIEmbeddingProvider, EmbedUseCase, and all
 * workspace utilities are mocked at the module boundary.
 *
 * All process.exit spies use try/finally to guarantee mockRestore is
 * called even when an assertion throws — preventing spy leakage between tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/workspace/resolver.js', () => ({
  requireWorkspace: vi.fn(() => '/test/workspace'),
}));

vi.mock('dotenv', () => ({
  default: { config: vi.fn() },
}));

vi.mock('ora', () => ({
  default: vi.fn(function () {
    return {
      start: vi.fn().mockReturnThis(),
      succeed: vi.fn().mockReturnThis(),
      fail: vi.fn().mockReturnThis(),
      text: '',
    };
  }),
}));

vi.mock('chalk', () => {
  const identity = (s: string) => s;
  const tagged = Object.assign(identity, {
    red: identity, green: identity, yellow: identity,
    blue: identity, dim: identity, bold: identity, cyan: identity,
  });
  return { default: tagged };
});

vi.mock('../../../src/adapters/postgres/index.js', () => {
  const closeFn = vi.fn().mockResolvedValue(undefined);
  return {
    PostgresStorage: vi.fn(function (this: Record<string, unknown>) {
      this['close'] = closeFn;
    }),
    _closeFn: closeFn,
  };
});

vi.mock('../../../src/adapters/openai/index.js', () => ({
  OpenAIEmbeddingProvider: vi.fn(function () { return {}; }),
}));

vi.mock('../../../src/use-cases/embed.js', () => {
  const executeFn = vi.fn().mockResolvedValue({ embeddedCount: 15, skippedCount: 3 });
  return {
    EmbedUseCase: vi.fn(function (this: Record<string, unknown>) {
      this['execute'] = executeFn;
    }),
    _executeFn: executeFn,
  };
});

interface EmbedMod { _executeFn: ReturnType<typeof vi.fn> }
interface StorageMod { _closeFn: ReturnType<typeof vi.fn> }

async function getCloseFn(): Promise<ReturnType<typeof vi.fn>> {
  return ((await import('../../../src/adapters/postgres/index.js')) as unknown as StorageMod)._closeFn;
}
async function getEmbedExecuteFn(): Promise<ReturnType<typeof vi.fn>> {
  return ((await import('../../../src/use-cases/embed.js')) as unknown as EmbedMod)._executeFn;
}

import { requireWorkspace } from '../../../src/workspace/resolver.js';
import { registerEmbedCommand } from '../../../src/cli/embed.js';
import type { Command } from 'commander';

const mockRequireWorkspace = vi.mocked(requireWorkspace);

/** Run a test body that expects process.exit(1), always restoring the spy. */
async function withExitSpy(fn: (spy: ReturnType<typeof vi.spyOn>) => Promise<void>): Promise<void> {
  const spy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
  try {
    await fn(spy);
  } finally {
    spy.mockRestore();
  }
}

interface EmbedOptions {
  batchSize?: string;
}

type AsyncAction = (options: EmbedOptions) => Promise<void>;

function captureAction(): AsyncAction {
  let captured: AsyncAction | undefined;

  const fakeCmd = {
    description: () => fakeCmd,
    option: () => fakeCmd,
    action(fn: AsyncAction) {
      captured = fn;
      return fakeCmd;
    },
  };

  const fakeProgram = {
    command: () => fakeCmd,
  };

  registerEmbedCommand(fakeProgram as unknown as Command);

  if (!captured) {throw new Error('No action was registered');}
  return captured;
}

beforeEach(async () => {
  vi.clearAllMocks();

  mockRequireWorkspace.mockReturnValue('/test/workspace');

  const closeFn = await getCloseFn();
  const embedExecuteFn = await getEmbedExecuteFn();

  closeFn.mockResolvedValue(undefined);
  embedExecuteFn.mockResolvedValue({ embeddedCount: 15, skippedCount: 3 });

  delete process.env['OPENAI_API_KEY'];
  delete process.env['DB_HOST'];
  delete process.env['DB_PORT'];
  delete process.env['DB_USER'];
  delete process.env['DB_NAME'];
});

// ─── missing OPENAI_API_KEY ───────────────────────────────────────────────────

describe('embed action — missing OPENAI_API_KEY', () => {
  it('calls process.exit(1) when OPENAI_API_KEY is not set', async () => {
    await withExitSpy(async (spy) => {
      const action = captureAction();
      await expect(action({})).rejects.toThrow('exit');
      expect(spy).toHaveBeenCalledWith(1);
    });
  });

  it('does not call EmbedUseCase.execute when API key is missing', async () => {
    const embedExecuteFn = await getEmbedExecuteFn();

    await withExitSpy(async () => {
      const action = captureAction();
      await expect(action({})).rejects.toThrow('exit');
    });

    expect(embedExecuteFn).not.toHaveBeenCalled();
  });
});

// ─── successful embedding ─────────────────────────────────────────────────────

describe('embed action — successful embedding', () => {
  beforeEach(() => {
    process.env['OPENAI_API_KEY'] = 'sk-testkey123';
  });

  it('calls EmbedUseCase.execute when OPENAI_API_KEY is set', async () => {
    const embedExecuteFn = await getEmbedExecuteFn();

    const action = captureAction();
    await action({});

    expect(embedExecuteFn).toHaveBeenCalledOnce();
  });

  it('calls storage.close after successful execution', async () => {
    const closeFn = await getCloseFn();

    const action = captureAction();
    await action({});

    expect(closeFn).toHaveBeenCalledOnce();
  });

  it('passes default batch size of 100 when no batchSize option is given', async () => {
    const embedExecuteFn = await getEmbedExecuteFn();

    const action = captureAction();
    await action({});

    expect(embedExecuteFn).toHaveBeenCalledWith(
      expect.objectContaining({ batchSize: 100 }),
    );
  });

  it('parses batchSize option from string to integer', async () => {
    const embedExecuteFn = await getEmbedExecuteFn();

    const action = captureAction();
    await action({ batchSize: '50' });

    expect(embedExecuteFn).toHaveBeenCalledWith(
      expect.objectContaining({ batchSize: 50 }),
    );
  });

  it('passes onProgress callback to EmbedUseCase.execute', async () => {
    const embedExecuteFn = await getEmbedExecuteFn();

    const action = captureAction();
    await action({});

    const callArg = embedExecuteFn.mock.calls[0]?.[0] as { onProgress?: unknown } | undefined;
    expect(typeof callArg?.onProgress).toBe('function');
  });
});

// ─── error handling ───────────────────────────────────────────────────────────

describe('embed action — error handling', () => {
  beforeEach(() => {
    process.env['OPENAI_API_KEY'] = 'sk-testkey123';
  });

  it('calls storage.close in the finally block even when execute throws', async () => {
    const embedExecuteFn = await getEmbedExecuteFn();
    const closeFn = await getCloseFn();
    embedExecuteFn.mockRejectedValue(new Error('OpenAI quota exceeded'));

    await withExitSpy(async (spy) => {
      const action = captureAction();
      await expect(action({})).rejects.toThrow('exit');
      expect(spy).toHaveBeenCalledWith(1);
    });

    expect(closeFn).toHaveBeenCalledOnce();
  });

  it('calls process.exit(1) when requireWorkspace throws', async () => {
    mockRequireWorkspace.mockImplementation(() => {
      throw new Error('Not inside an Argustack workspace');
    });

    await withExitSpy(async (spy) => {
      const action = captureAction();
      await expect(action({})).rejects.toThrow('exit');
      expect(spy).toHaveBeenCalledWith(1);
    });
  });

  it('calls process.exit(1) when EmbedUseCase.execute throws unexpectedly', async () => {
    const embedExecuteFn = await getEmbedExecuteFn();
    const closeFn = await getCloseFn();
    embedExecuteFn.mockRejectedValue(new Error('Unexpected DB error'));

    await withExitSpy(async (spy) => {
      const action = captureAction();
      await expect(action({})).rejects.toThrow('exit');
      expect(spy).toHaveBeenCalledWith(1);
    });

    expect(closeFn).toHaveBeenCalledOnce();
  });
});

// ─── PostgresStorage construction ────────────────────────────────────────────

describe('embed action — PostgresStorage construction', () => {
  beforeEach(() => {
    process.env['OPENAI_API_KEY'] = 'sk-testkey123';
  });

  it('constructs PostgresStorage with defaults when no DB env vars are set', async () => {
    const { PostgresStorage } = await import('../../../src/adapters/postgres/index.js');
    const action = captureAction();
    await action({});

    expect(vi.mocked(PostgresStorage)).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'localhost',
        port: 5434,
        user: 'argustack',
        database: 'argustack',
      }),
    );
  });

  it('constructs PostgresStorage with custom env vars when provided', async () => {
    process.env['DB_HOST'] = 'custom-host';
    process.env['DB_PORT'] = '5999';
    process.env['DB_USER'] = 'custom-user';
    process.env['DB_NAME'] = 'custom-db';

    const { PostgresStorage } = await import('../../../src/adapters/postgres/index.js');
    const action = captureAction();
    await action({});

    expect(vi.mocked(PostgresStorage)).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'custom-host',
        port: 5999,
        user: 'custom-user',
        database: 'custom-db',
      }),
    );
  });
});
