/**
 * Unit tests for `adapters/postgres/migrate-helpers.ts` — the building
 * blocks behind `argustack migrate-to-hub`.
 *
 * Each helper takes a `pg.Pool` — we drive them via a minimal mock pool
 * whose `query()` returns canned row sets. The filesystem helper
 * (`discoverLegacyDbConfig`) is exercised with `node:fs` mocked so no
 * real files are touched.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type pg from 'pg';
import type * as MigrateHelpersModule from '../../../../src/adapters/postgres/migrate-helpers.js';
import { TEST_IDS } from '../../../fixtures/shared/test-constants.js';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

let existsSync: ReturnType<typeof vi.fn>;
let readFileSync: ReturnType<typeof vi.fn>;

let helpers: typeof MigrateHelpersModule;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();

  const fsMod = await import('node:fs');
  existsSync = vi.mocked(fsMod.existsSync);
  readFileSync = vi.mocked(fsMod.readFileSync);

  helpers = await import('../../../../src/adapters/postgres/migrate-helpers.js');
});

interface MockPool {
  query: ReturnType<typeof vi.fn>;
}

function makePool(): MockPool {
  return { query: vi.fn() };
}

function asPool(pool: MockPool): pg.Pool {
  return pool as unknown as pg.Pool;
}

describe('discoverLegacyDbConfig', () => {
  it('returns built-in defaults when .env is missing', () => {
    existsSync.mockReturnValue(false);

    const result = helpers.discoverLegacyDbConfig('/some/workspace');

    expect(result).toEqual({
      host: 'localhost',
      port: 5434,
      user: 'argustack',
      password: 'argustack_local',
      database: 'argustack',
    });
    expect(readFileSync).not.toHaveBeenCalled();
  });

  it('overrides defaults from .env values', () => {
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue(
      [
        'DB_HOST=db.internal',
        'DB_PORT=6543',
        'DB_USER=app',
        'DB_PASSWORD="s3cret"',
        "DB_NAME='myapp'",
      ].join('\n'),
    );

    const result = helpers.discoverLegacyDbConfig('/ws');

    expect(result).toEqual({
      host: 'db.internal',
      port: 6543,
      user: 'app',
      password: 's3cret',
      database: 'myapp',
    });
  });

  it('falls back to default port when DB_PORT is invalid', () => {
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue('DB_PORT=not-a-number\n');

    const result = helpers.discoverLegacyDbConfig('/ws');

    expect(result.port).toBe(5434);
  });

  it('skips comments and blank lines', () => {
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue('# comment\n\nDB_HOST=somehost\n');

    const result = helpers.discoverLegacyDbConfig('/ws');

    expect(result.host).toBe('somehost');
  });
});

describe('countTable', () => {
  it('returns the COUNT(*) value from the row', async () => {
    const pool = makePool();
    pool.query.mockResolvedValueOnce({ rows: [{ count: '42' }] });

    const result = await helpers.countTable(asPool(pool), 'issues');

    expect(result).toBe(42);
    const call = pool.query.mock.calls[0];
    if (call === undefined) {
      throw new Error('expected query call');
    }
    const [sql] = call as [string];
    expect(sql).toMatch(/SELECT COUNT\(\*\)::text AS count FROM issues/);
  });

  it('returns 0 when no row is returned', async () => {
    const pool = makePool();
    pool.query.mockResolvedValueOnce({ rows: [] });

    const result = await helpers.countTable(asPool(pool), 'issues');

    expect(result).toBe(0);
  });
});

describe('verifyCounts', () => {
  it('returns an empty list when legacy and hub counts match', async () => {
    const legacy = makePool();
    const hub = makePool();

    legacy.query.mockResolvedValueOnce({ rows: [{ count: '10' }] });
    hub.query.mockResolvedValueOnce({ rows: [{ count: '10' }] });

    const mismatches = await helpers.verifyCounts(asPool(legacy), asPool(hub), 'demo', ['issues']);

    expect(mismatches).toEqual([]);
  });

  it('reports mismatches per table', async () => {
    const legacy = makePool();
    const hub = makePool();

    legacy.query
      .mockResolvedValueOnce({ rows: [{ count: '5' }] })
      .mockResolvedValueOnce({ rows: [{ count: '7' }] });
    hub.query
      .mockResolvedValueOnce({ rows: [{ count: '5' }] })
      .mockResolvedValueOnce({ rows: [{ count: '6' }] });

    const mismatches = await helpers.verifyCounts(
      asPool(legacy),
      asPool(hub),
      'demo',
      ['issues', 'commits'],
    );

    expect(mismatches).toEqual([{ table: 'commits', legacy: 7, hub: 6 }]);
  });
});

describe('copyTable', () => {
  it('returns 0 and issues a single SELECT when source is empty', async () => {
    const src = makePool();
    const dst = makePool();
    src.query.mockResolvedValueOnce({ rows: [] });

    const total = await helpers.copyTable(asPool(src), asPool(dst), 'demo', 'issues', ['id', 'title']);

    expect(total).toBe(0);
    expect(src.query).toHaveBeenCalledOnce();
    expect(dst.query).not.toHaveBeenCalled();
  });

  it('copies rows from source to destination with workspace_id prepended', async () => {
    const src = makePool();
    const dst = makePool();
    src.query
      .mockResolvedValueOnce({ rows: [{ id: 1, title: 'a' }, { id: 2, title: 'b' }] })
      .mockResolvedValueOnce({ rows: [] });
    dst.query.mockResolvedValue({ rows: [] });

    const total = await helpers.copyTable(asPool(src), asPool(dst), 'demo', 'issues', ['id', 'title']);

    expect(total).toBe(2);
    expect(dst.query).toHaveBeenCalledTimes(2);
    const firstInsert = dst.query.mock.calls[0];
    if (firstInsert === undefined) {
      throw new Error('expected dst insert');
    }
    const [insertSql, params] = firstInsert as [string, unknown[]];
    expect(insertSql).toMatch(/INSERT INTO issues \(workspace_id, id, title\)/);
    expect(insertSql).toMatch(/ON CONFLICT DO NOTHING/);
    expect(params[0]).toBe('demo');
    expect(params[1]).toBe(1);
    expect(params[2]).toBe('a');
  });

  it('rewrites remapped columns through idRemap', async () => {
    const src = makePool();
    const dst = makePool();
    src.query
      .mockResolvedValueOnce({ rows: [{ id: 99, source_id: 10, target_id: 11 }] })
      .mockResolvedValueOnce({ rows: [] });
    dst.query.mockResolvedValue({ rows: [] });

    const idRemap = new Map<number, number>([
      [10, 100],
      [11, 110],
    ]);

    const total = await helpers.copyTable(
      asPool(src),
      asPool(dst),
      'demo',
      'graph_relationships',
      ['id', 'source_id', 'target_id'],
      { idRemap, remappedColumns: ['source_id', 'target_id'] },
    );

    expect(total).toBe(1);
    const insert = dst.query.mock.calls[0];
    if (insert === undefined) {
      throw new Error('expected insert call');
    }
    const [, params] = insert as [string, unknown[]];
    expect(params[2]).toBe(100);
    expect(params[3]).toBe(110);
  });

  it('skips rows that violate constraints (catch swallows errors)', async () => {
    const src = makePool();
    const dst = makePool();
    src.query
      .mockResolvedValueOnce({ rows: [{ id: 1 }] })
      .mockResolvedValueOnce({ rows: [] });
    dst.query.mockRejectedValueOnce(new Error('duplicate key'));

    const total = await helpers.copyTable(asPool(src), asPool(dst), 'demo', 'issues', ['id']);

    expect(total).toBe(1);
  });
});

describe('copyGraphEntities', () => {
  it('returns an empty map when source has no entities', async () => {
    const src = makePool();
    const dst = makePool();
    src.query.mockResolvedValueOnce({ rows: [] });

    const map = await helpers.copyGraphEntities(asPool(src), asPool(dst), 'demo');

    expect(map.size).toBe(0);
    expect(dst.query).not.toHaveBeenCalled();
  });

  it('maps legacy ids to new hub ids', async () => {
    const src = makePool();
    const dst = makePool();
    src.query.mockResolvedValueOnce({
      rows: [
        { id: 1, name: TEST_IDS.issueKey, type: 'issue', properties: { key: 'value' } },
        { id: 2, name: TEST_IDS.issueKey2, type: 'issue', properties: null },
      ],
    });
    dst.query
      .mockResolvedValueOnce({ rows: [{ id: 101 }] })
      .mockResolvedValueOnce({ rows: [{ id: 102 }] });

    const map = await helpers.copyGraphEntities(asPool(src), asPool(dst), 'demo');

    expect(map.get(1)).toBe(101);
    expect(map.get(2)).toBe(102);
    const firstInsert = dst.query.mock.calls[0];
    if (firstInsert === undefined) {
      throw new Error('expected dst insert');
    }
    const [sql, params] = firstInsert as [string, unknown[]];
    expect(sql).toMatch(/INSERT INTO graph_entities/);
    expect(sql).toMatch(/ON CONFLICT \(workspace_id, name, type\) DO UPDATE/);
    expect(params[0]).toBe('demo');
    expect(params[3]).toBe(JSON.stringify({ key: 'value' }));
  });
});
