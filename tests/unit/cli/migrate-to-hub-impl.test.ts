/**
 * Unit tests for MigrateToHubUseCase — the legacy → hub migration engine.
 *
 * We mock the postgres adapter helpers used inside the use-case
 * (copyTable, copyGraphEntities, countTable, verifyCounts,
 * discoverLegacyDbConfig, createPool) and the fs/mkdir/write marker
 * functions. The IWorkspaceStore is a FakeWorkspaceStore.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type pg from 'pg';

vi.mock('../../../src/adapters/postgres/migrate-helpers.js', () => ({
  copyTable: vi.fn().mockResolvedValue(0),
  copyGraphEntities: vi.fn().mockResolvedValue(new Map<number, number>()),
  countTable: vi.fn().mockResolvedValue(0),
  verifyCounts: vi.fn().mockResolvedValue([]),
  discoverLegacyDbConfig: vi.fn().mockReturnValue({
    host: 'localhost', port: 5434, user: 'u', password: 'p', database: 'd',
  }),
}));

vi.mock('../../../src/adapters/postgres/connection.js', () => ({
  createPool: vi.fn(),
}));

vi.mock('node:fs', () => ({
  writeFileSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(false),
  mkdirSync: vi.fn(),
}));

import { MigrateToHubUseCase, type LegacyWorkspaceInfo } from '../../../src/cli/migrate-to-hub-impl.js';
import {
  copyTable,
  copyGraphEntities,
  countTable,
  verifyCounts,
  discoverLegacyDbConfig,
} from '../../../src/adapters/postgres/migrate-helpers.js';
import { createPool } from '../../../src/adapters/postgres/connection.js';
import * as fs from 'node:fs';
import { FakeWorkspaceStore } from '../../fixtures/fakes/fake-workspace-store.js';

interface FakeSourcePool {
  query: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
}

function makeSourcePool(): FakeSourcePool {
  return {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    end: vi.fn().mockResolvedValue(undefined),
  };
}

function makeHubPool(): FakeSourcePool {
  return {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    end: vi.fn().mockResolvedValue(undefined),
  };
}

const LEGACY: LegacyWorkspaceInfo[] = [
  { id: 'old', name: 'Old Workspace', path: '/tmp/old-ws' },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(copyTable).mockResolvedValue(0);
  vi.mocked(copyGraphEntities).mockResolvedValue(new Map());
  vi.mocked(countTable).mockResolvedValue(0);
  vi.mocked(verifyCounts).mockResolvedValue([]);
  vi.mocked(discoverLegacyDbConfig).mockReturnValue({
    host: 'localhost', port: 5434, user: 'u', password: 'p', database: 'd',
  });
  vi.mocked(fs.existsSync).mockReturnValue(false);
});

describe('MigrateToHubUseCase.execute', () => {
  it('returns empty result when no legacy workspaces provided', async () => {
    const hubPool = makeHubPool();
    const useCase = new MigrateToHubUseCase(hubPool as unknown as pg.Pool, new FakeWorkspaceStore());

    const result = await useCase.execute([]);

    expect(result.migrated).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(result.mismatches).toEqual([]);
  });

  it('migrates a single workspace and reports it as migrated', async () => {
    const srcPool = makeSourcePool();
    vi.mocked(createPool).mockReturnValue(srcPool as unknown as pg.Pool);
    const hubPool = makeHubPool();
    const store = new FakeWorkspaceStore();
    const useCase = new MigrateToHubUseCase(hubPool as unknown as pg.Pool, store);

    const result = await useCase.execute(LEGACY);

    expect(result.migrated).toEqual(['old']);
    expect(result.skipped).toEqual([]);
    expect(store.createCalls).toHaveLength(1);
    expect(store.createCalls[0]?.id).toBe('old');
    expect(srcPool.end).toHaveBeenCalled();
  });

  it('dry-run does not write to the hub store', async () => {
    const srcPool = makeSourcePool();
    vi.mocked(createPool).mockReturnValue(srcPool as unknown as pg.Pool);
    const hubPool = makeHubPool();
    const store = new FakeWorkspaceStore();
    const useCase = new MigrateToHubUseCase(hubPool as unknown as pg.Pool, store);

    const result = await useCase.execute(LEGACY, { dryRun: true });

    expect(result.migrated).toEqual([]);
    expect(store.createCalls).toHaveLength(0);
    expect(copyTable).not.toHaveBeenCalled();
  });

  it('applies --rename to remap legacy id → hub id', async () => {
    const srcPool = makeSourcePool();
    vi.mocked(createPool).mockReturnValue(srcPool as unknown as pg.Pool);
    const hubPool = makeHubPool();
    const store = new FakeWorkspaceStore();
    const useCase = new MigrateToHubUseCase(hubPool as unknown as pg.Pool, store);

    const result = await useCase.execute(LEGACY, { rename: { old: 'fresh' } });

    expect(result.migrated).toEqual(['fresh']);
    expect(store.createCalls[0]?.id).toBe('fresh');
  });

  it('reports the workspace as skipped when an error occurs', async () => {
    const srcPool = makeSourcePool();
    srcPool.query.mockRejectedValue(new Error('connection refused'));
    vi.mocked(createPool).mockReturnValue(srcPool as unknown as pg.Pool);
    vi.mocked(countTable).mockResolvedValue(0);
    const hubPool = makeHubPool();
    const store = new FakeWorkspaceStore();
    store.create = vi.fn().mockRejectedValue(new Error('boom')) as never;

    const useCase = new MigrateToHubUseCase(hubPool as unknown as pg.Pool, store);
    const result = await useCase.execute(LEGACY);

    expect(result.skipped).toEqual(['old']);
    expect(result.migrated).toEqual([]);
  });

  it('returns count mismatches when verifyCounts surfaces them', async () => {
    const srcPool = makeSourcePool();
    vi.mocked(createPool).mockReturnValue(srcPool as unknown as pg.Pool);
    vi.mocked(verifyCounts).mockResolvedValue([{ table: 'issues', legacy: 10, hub: 9 }]);
    const hubPool = makeHubPool();
    const store = new FakeWorkspaceStore();

    const useCase = new MigrateToHubUseCase(hubPool as unknown as pg.Pool, store);
    const result = await useCase.execute(LEGACY);

    expect(result.mismatches).toHaveLength(1);
    expect(result.mismatches[0]?.workspaceId).toBe('old');
    expect(result.mismatches[0]?.mismatches[0]?.table).toBe('issues');
  });

  it('writes the .hub-migrated marker by default', async () => {
    const srcPool = makeSourcePool();
    vi.mocked(createPool).mockReturnValue(srcPool as unknown as pg.Pool);
    const hubPool = makeHubPool();
    const useCase = new MigrateToHubUseCase(hubPool as unknown as pg.Pool, new FakeWorkspaceStore());

    await useCase.execute(LEGACY);

    expect(fs.writeFileSync).toHaveBeenCalled();
    expect(fs.mkdirSync).toHaveBeenCalled();
  });

  it('skips the marker when keepLegacy=true', async () => {
    const srcPool = makeSourcePool();
    vi.mocked(createPool).mockReturnValue(srcPool as unknown as pg.Pool);
    const hubPool = makeHubPool();
    const useCase = new MigrateToHubUseCase(hubPool as unknown as pg.Pool, new FakeWorkspaceStore());

    await useCase.execute(LEGACY, { keepLegacy: true });

    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('forwards onProgress messages for each workspace', async () => {
    const srcPool = makeSourcePool();
    vi.mocked(createPool).mockReturnValue(srcPool as unknown as pg.Pool);
    const hubPool = makeHubPool();
    const onProgress = vi.fn();
    const useCase = new MigrateToHubUseCase(hubPool as unknown as pg.Pool, new FakeWorkspaceStore());

    await useCase.execute(LEGACY, { onProgress });

    const messages = onProgress.mock.calls.flat().join(' ');
    expect(messages).toContain('Old Workspace');
    expect(messages).toContain('hub workspace_id');
  });
});
