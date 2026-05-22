/**
 * Unit tests for {@link PostgresDbSchemaStorage} — external app DB
 * schema mirror.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type pg from 'pg';
import { PostgresDbSchemaStorage } from '../../../../src/adapters/postgres/storage-dbschema.js';
import type { DbSchemaBatch } from '../../../../src/core/types/database.js';

const WS = 'ws-test';
const SRC = 'app-db';

interface MockClient {
  query: ReturnType<typeof vi.fn<(sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>>>;
  release: ReturnType<typeof vi.fn>;
}

function makeBatch(): DbSchemaBatch {
  return {
    tables: [{
      sourceName: SRC,
      schema: 'public',
      name: 'users',
      rowCount: 100,
      sizeBytes: 4096,
      columns: [{
        tableName: 'users', name: 'id', dataType: 'integer', nullable: false, defaultValue: null, isPrimaryKey: true, ordinalPosition: 1,
      }],
    }],
    foreignKeys: [{
      tableName: 'orders', columnName: 'user_id', referencedTable: 'users', referencedColumn: 'id',
    }],
    indexes: [{
      tableName: 'users', indexName: 'users_pkey', columns: ['id'], isUnique: true, isPrimary: true,
    }],
  };
}

let client: MockClient;
let pool: { query: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn>; };
let storage: PostgresDbSchemaStorage;

beforeEach(() => {
  client = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }), release: vi.fn() };
  pool = {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
    connect: vi.fn().mockResolvedValue(client),
  };
  storage = new PostgresDbSchemaStorage(pool as unknown as pg.Pool);
});

describe('saveDbSchemaBatch', () => {
  it('upserts tables, columns, FKs, indexes inside transaction', async () => {
    await storage.saveDbSchemaBatch(WS, makeBatch(), SRC);

    const sqls = client.query.mock.calls.map((c) => c[0]);
    expect(sqls).toContain('BEGIN');
    expect(sqls).toContain('COMMIT');
    expect(sqls.some((s) => s.includes('INSERT INTO db_tables'))).toBe(true);
    expect(sqls.some((s) => s.includes('INSERT INTO db_columns'))).toBe(true);
    expect(sqls.some((s) => s.includes('INSERT INTO db_foreign_keys'))).toBe(true);
    expect(sqls.some((s) => s.includes('INSERT INTO db_indexes'))).toBe(true);
  });

  it('rolls back when an insert throws', async () => {
    client.query.mockImplementation(async (sql: string) => {
      await Promise.resolve();
      if (sql.includes('INSERT INTO db_tables')) {
        throw new Error('boom');
      }
      return { rows: [], rowCount: 1 };
    });

    await expect(storage.saveDbSchemaBatch(WS, makeBatch(), SRC)).rejects.toThrow('boom');
    expect(client.query.mock.calls.map((c) => c[0])).toContain('ROLLBACK');
  });

  it('binds workspace_id + source_name into every INSERT', async () => {
    await storage.saveDbSchemaBatch(WS, makeBatch(), SRC);

    const tableInsert = client.query.mock.calls.find((c) => c[0].includes('INSERT INTO db_tables'));
    if (tableInsert === undefined) { throw new Error('db_tables insert not found'); }
    const params = tableInsert[1] ?? [];
    expect(params.slice(0, 2)).toEqual([WS, SRC]);
  });
});

describe('deleteDbSchema', () => {
  it('deletes from all 4 db_* tables for the (workspace, source)', async () => {
    await storage.deleteDbSchema(WS, SRC);

    const sqls = pool.query.mock.calls.map((c): string => String(c[0]));
    expect(sqls).toEqual([
      expect.stringContaining('DELETE FROM db_indexes'),
      expect.stringContaining('DELETE FROM db_foreign_keys'),
      expect.stringContaining('DELETE FROM db_columns'),
      expect.stringContaining('DELETE FROM db_tables'),
    ]);
  });

  it('binds workspace_id and source_name to every DELETE', async () => {
    await storage.deleteDbSchema(WS, SRC);

    for (const call of pool.query.mock.calls) {
      expect(call[1]).toEqual([WS, SRC]);
    }
  });
});
