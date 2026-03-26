/**
 * Unit tests for the registerStatusCommand action handler.
 *
 * The action is async. It is extracted from Commander by capturing the
 * callback registered via a fake Command stub. PostgresStorage and all
 * workspace utilities are mocked at the module boundary.
 *
 * The PostgresStorage mock is defined as a factory function so that the
 * per-test spy objects (queryFn, closeFn) are read lazily at construction
 * time, avoiding the vi.mock hoisting issue with module-scope variables.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createWorkspaceConfig } from '../../fixtures/shared/test-constants.js';

vi.mock('../../../src/workspace/resolver.js', () => ({
  requireWorkspace: vi.fn(() => '/test/workspace'),
}));

vi.mock('../../../src/workspace/config.js', () => ({
  readConfig: vi.fn(),
  getEnabledSources: vi.fn(() => []),
}));

vi.mock('dotenv', () => ({
  default: { config: vi.fn() },
}));

vi.mock('../../../src/adapters/postgres/index.js', () => {
  const queryFn = vi.fn().mockResolvedValue({ rows: [] });
  const closeFn = vi.fn().mockResolvedValue(undefined);

  return {
    PostgresStorage: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
      this['query'] = queryFn;
      this['close'] = closeFn;
    }),
    _queryFn: queryFn,
    _closeFn: closeFn,
  };
});

import { requireWorkspace } from '../../../src/workspace/resolver.js';
import { readConfig, getEnabledSources } from '../../../src/workspace/config.js';
import { registerStatusCommand } from '../../../src/cli/status.js';
import type { Command } from 'commander';

const mockRequireWorkspace = vi.mocked(requireWorkspace);
const mockReadConfig = vi.mocked(readConfig);
const mockGetEnabledSources = vi.mocked(getEnabledSources);

async function getStorageSpies(): Promise<{ queryFn: ReturnType<typeof vi.fn>; closeFn: ReturnType<typeof vi.fn> }> {
  const mod = await import('../../../src/adapters/postgres/index.js') as {
    _queryFn: ReturnType<typeof vi.fn>;
    _closeFn: ReturnType<typeof vi.fn>;
  };
  return { queryFn: mod._queryFn, closeFn: mod._closeFn };
}

type AsyncAction = () => Promise<void>;

function captureAction(): AsyncAction {
  let captured: AsyncAction | undefined;

  const fakeProgram = {
    command: () => fakeProgram,
    description: () => fakeProgram,
    action(fn: AsyncAction) {
      captured = fn;
      return fakeProgram;
    },
  };

  registerStatusCommand(fakeProgram as unknown as Command);

  if (!captured) {throw new Error('No action was registered');}
  return captured;
}

beforeEach(async () => {
  vi.clearAllMocks();
  const { queryFn, closeFn } = await getStorageSpies();
  queryFn.mockResolvedValue({ rows: [] });
  closeFn.mockResolvedValue(undefined);
});

// ─── no config ───────────────────────────────────────────────────────────────

describe('status action — no config', () => {
  it('calls process.exit(1) when readConfig returns null', async () => {
    mockReadConfig.mockReturnValue(null);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

    const action = captureAction();
    await expect(action()).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
  });
});

// ─── no sources enabled ──────────────────────────────────────────────────────

describe('status action — no sources enabled', () => {
  it('does not attempt to connect to storage when no sources are enabled', async () => {
    const { queryFn, closeFn } = await getStorageSpies();
    const config = createWorkspaceConfig();
    mockReadConfig.mockReturnValue(config);
    mockGetEnabledSources.mockReturnValue([]);

    const action = captureAction();
    await action();

    expect(queryFn).not.toHaveBeenCalled();
    expect(closeFn).not.toHaveBeenCalled();
  });

  it('completes without error when workspace has no enabled sources', async () => {
    const config = createWorkspaceConfig();
    mockReadConfig.mockReturnValue(config);
    mockGetEnabledSources.mockReturnValue([]);

    const action = captureAction();
    await expect(action()).resolves.toBeUndefined();
  });
});

// ─── sources enabled, storage available ──────────────────────────────────────

describe('status action — sources enabled, storage available', () => {
  it('queries issue counts and calls close when sources are enabled', async () => {
    const { queryFn, closeFn } = await getStorageSpies();
    const config = createWorkspaceConfig({
      sources: { jira: { enabled: true, addedAt: '2025-01-01T00:00:00.000Z' } },
      order: ['jira'],
    });
    mockReadConfig.mockReturnValue(config);
    mockGetEnabledSources.mockReturnValue(['jira']);
    queryFn.mockResolvedValue({
      rows: [{ source: 'jira', cnt: '42' }],
    });

    const action = captureAction();
    await action();

    expect(queryFn).toHaveBeenCalled();
    expect(closeFn).toHaveBeenCalled();
  });

  it('calls close even when the query throws an error', async () => {
    const { queryFn, closeFn } = await getStorageSpies();
    const config = createWorkspaceConfig({
      sources: { jira: { enabled: true, addedAt: '2025-01-01T00:00:00.000Z' } },
      order: ['jira'],
    });
    mockReadConfig.mockReturnValue(config);
    mockGetEnabledSources.mockReturnValue(['jira']);
    queryFn.mockRejectedValue(new Error('connection refused'));

    const action = captureAction();
    await expect(action()).resolves.toBeUndefined();
    expect(closeFn).toHaveBeenCalled();
  });

  it('does not throw when PostgresStorage constructor throws', async () => {
    const config = createWorkspaceConfig({
      sources: { jira: { enabled: true, addedAt: '2025-01-01T00:00:00.000Z' } },
      order: ['jira'],
    });
    mockReadConfig.mockReturnValue(config);
    mockGetEnabledSources.mockReturnValue(['jira']);

    const { PostgresStorage } = await import('../../../src/adapters/postgres/index.js');
    vi.mocked(PostgresStorage).mockImplementationOnce(() => {
      throw new Error('Docker not running');
    });

    const action = captureAction();
    await expect(action()).resolves.toBeUndefined();
  });
});

// ─── error handling ──────────────────────────────────────────────────────────

describe('status action — error handling', () => {
  it('calls process.exit(1) when requireWorkspace throws', async () => {
    mockRequireWorkspace.mockImplementation(() => {
      throw new Error('Not inside an Argustack workspace');
    });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

    const action = captureAction();
    await expect(action()).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
  });
});
