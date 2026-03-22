import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DB_TEST_IDS, createDbTable, createDbColumn, createDbForeignKey, createDbIndex } from '../../../fixtures/shared/test-constants.js';
import type { DbSchemaBatch } from '../../../../src/core/types/database.js';

vi.mock('../../../../src/adapters/db/client.js', () => ({
  createKnexClient: vi.fn(),
}));

vi.mock('../../../../src/adapters/db/sql-validator.js', () => ({
  validateSql: vi.fn(() => ({ valid: true })),
}));

vi.mock('../../../../src/adapters/db/mapper.js', () => ({
  mapTableRow: vi.fn((_raw: unknown, sourceName: string) => ({
    ...createDbTable({ sourceName }),
    columns: [],
  })),
  mapColumnRow: vi.fn(() => createDbColumn()),
  mapForeignKeyRow: vi.fn(() => createDbForeignKey()),
  mapIndexRows: vi.fn(() => [createDbIndex()]),
}));

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let DbProvider: typeof import('../../../../src/adapters/db/provider.js').DbProvider;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let createKnexClient: typeof import('../../../../src/adapters/db/client.js').createKnexClient;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let validateSql: typeof import('../../../../src/adapters/db/sql-validator.js').validateSql;

type MockFn = ReturnType<typeof vi.fn>;

interface MockKnex {
  raw: MockFn;
  destroy: MockFn;
}

function createMockKnex(): MockKnex {
  return {
    raw: vi.fn().mockResolvedValue({ rows: [] }),
    destroy: vi.fn().mockResolvedValue(undefined),
  };
}

const DB_CONFIG = {
  engine: 'postgresql' as const,
  host: 'localhost',
  port: 5432,
  user: 'test',
  password: 'test',
  database: 'testdb',
  name: DB_TEST_IDS.sourceName,
};

let mockKnex: MockKnex;

beforeEach(async () => {
  vi.clearAllMocks();
  mockKnex = createMockKnex();

  const clientModule = await import('../../../../src/adapters/db/client.js');
  createKnexClient = clientModule.createKnexClient;
  vi.mocked(createKnexClient).mockReturnValue(mockKnex as never);

  const validatorModule = await import('../../../../src/adapters/db/sql-validator.js');
  validateSql = validatorModule.validateSql;

  const providerModule = await import('../../../../src/adapters/db/provider.js');
  DbProvider = providerModule.DbProvider;
});

describe('DbProvider', () => {
  describe('constructor', () => {
    it('uses config.name as provider name', () => {
      const provider = new DbProvider(DB_CONFIG);
      expect(provider.name).toBe(DB_TEST_IDS.sourceName);
    });

    it('falls back to engine:database when name is empty', () => {
      const provider = new DbProvider({ ...DB_CONFIG, name: '' });
      expect(provider.name).toBe('postgresql:testdb');
    });

    it('exposes engine', () => {
      const provider = new DbProvider(DB_CONFIG);
      expect(provider.engine).toBe('postgresql');
    });
  });

  describe('connect', () => {
    it('creates Knex client and runs connectivity check', async () => {
      const provider = new DbProvider(DB_CONFIG);
      await provider.connect();

      expect(createKnexClient).toHaveBeenCalledWith(DB_CONFIG);
      expect(mockKnex.raw).toHaveBeenCalledWith('SELECT 1');
    });

    it('throws when connectivity check fails', async () => {
      mockKnex.raw.mockRejectedValueOnce(new Error('Connection refused'));

      const provider = new DbProvider(DB_CONFIG);
      await expect(provider.connect()).rejects.toThrow('Connection refused');
    });
  });

  describe('introspect', () => {
    it('yields schema batch with tables, foreign keys, and indexes', async () => {
      mockKnex.raw
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ table_schema: 'public', table_name: DB_TEST_IDS.tableName }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ table_name: DB_TEST_IDS.tableName, column_name: 'id', data_type: 'integer', is_nullable: 'NO', column_default: null, ordinal_position: 1 }] })
        .mockResolvedValueOnce({ rows: [{ table_name: 'orders', column_name: 'user_id', referenced_table: 'users', referenced_column: 'id' }] })
        .mockResolvedValueOnce({ rows: [{ table_name: DB_TEST_IDS.tableName, index_name: 'idx_email', column_name: 'email', is_unique: true, is_primary: false }] });

      const provider = new DbProvider(DB_CONFIG);
      await provider.connect();

      const batches: DbSchemaBatch[] = [];
      for await (const batch of provider.introspect()) {
        batches.push(batch);
      }

      expect(batches).toHaveLength(1);
      expect(batches[0]?.tables).toHaveLength(1);
      expect(batches[0]?.foreignKeys).toHaveLength(1);
      expect(batches[0]?.indexes).toHaveLength(1);
    });

    it('throws when not connected', async () => {
      const provider = new DbProvider(DB_CONFIG);

      const generator = provider.introspect();
      await expect(generator.next()).rejects.toThrow('Not connected');
    });
  });

  describe('query', () => {
    it('validates SQL before executing', async () => {
      mockKnex.raw.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ count: 5 }] });

      const provider = new DbProvider(DB_CONFIG);
      await provider.connect();
      const result = await provider.query('SELECT COUNT(*) FROM users');

      expect(validateSql).toHaveBeenCalledWith('SELECT COUNT(*) FROM users');
      expect(result.rows).toHaveLength(1);
    });

    it('rejects invalid SQL', async () => {
      mockKnex.raw.mockResolvedValueOnce({ rows: [] });
      vi.mocked(validateSql).mockReturnValueOnce({ valid: false, reason: 'Forbidden: DELETE' });

      const provider = new DbProvider(DB_CONFIG);
      await provider.connect();

      await expect(provider.query('DELETE FROM users')).rejects.toThrow('Query rejected: Forbidden: DELETE');
    });

    it('appends LIMIT when not present', async () => {
      mockKnex.raw
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const provider = new DbProvider(DB_CONFIG);
      await provider.connect();
      await provider.query('SELECT * FROM users');

      expect(mockKnex.raw).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT 1000'),
      );
    });

    it('preserves existing LIMIT', async () => {
      mockKnex.raw
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const provider = new DbProvider(DB_CONFIG);
      await provider.connect();
      await provider.query('SELECT * FROM users LIMIT 10');

      const calls = mockKnex.raw.mock.calls;
      const querySql = calls[1]?.[0] as string;
      expect(querySql).not.toContain('LIMIT 1000');
      expect(querySql).toContain('LIMIT 10');
    });

    it('throws when not connected', async () => {
      const provider = new DbProvider(DB_CONFIG);
      await expect(provider.query('SELECT 1')).rejects.toThrow('Not connected');
    });
  });

  describe('getTableCount', () => {
    it('returns count for postgresql', async () => {
      mockKnex.raw
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ count: 15 }] });

      const provider = new DbProvider(DB_CONFIG);
      await provider.connect();
      const count = await provider.getTableCount();

      expect(count).toBe(15);
    });

    it('returns 0 for unsupported engines', async () => {
      mockKnex.raw.mockResolvedValueOnce({ rows: [] });

      const provider = new DbProvider({ ...DB_CONFIG, engine: 'sqlite' as const });
      await provider.connect();
      const count = await provider.getTableCount();

      expect(count).toBe(0);
    });
  });

  describe('disconnect', () => {
    it('destroys Knex connection', async () => {
      mockKnex.raw.mockResolvedValueOnce({ rows: [] });

      const provider = new DbProvider(DB_CONFIG);
      await provider.connect();
      await provider.disconnect();

      expect(mockKnex.destroy).toHaveBeenCalled();
    });

    it('does nothing when not connected', async () => {
      const provider = new DbProvider(DB_CONFIG);
      await provider.disconnect();
      expect(mockKnex.destroy).not.toHaveBeenCalled();
    });
  });
});

describe('DbProvider — extractRows shapes', () => {
  it('handles result with obj[0] array (mysql-style raw response)', async () => {
    mockKnex.raw
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce([[{ id: 1 }, { id: 2 }], []]);

    const provider = new DbProvider(DB_CONFIG);
    await provider.connect();
    const result = await provider.query('SELECT id FROM users');

    expect(result.rows).toHaveLength(2);
  });

  it('returns empty array when result has no recognised shape', async () => {
    mockKnex.raw
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ unrecognised: true });

    const provider = new DbProvider(DB_CONFIG);
    await provider.connect();
    const result = await provider.query('SELECT id FROM users');

    expect(result.rows).toHaveLength(0);
  });
});

describe('DbProvider — query strips trailing semicolons', () => {
  it('removes trailing semicolon before appending LIMIT', async () => {
    mockKnex.raw
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const provider = new DbProvider(DB_CONFIG);
    await provider.connect();
    await provider.query('SELECT * FROM users;');

    const calls = mockKnex.raw.mock.calls;
    const querySql = calls[1]?.[0] as string;
    expect(querySql).not.toContain(';;');
    expect(querySql).toContain('LIMIT 1000');
  });

  it('removes trailing semicolon with surrounding whitespace', async () => {
    mockKnex.raw
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const provider = new DbProvider(DB_CONFIG);
    await provider.connect();
    await provider.query('SELECT * FROM users;   ');

    const calls = mockKnex.raw.mock.calls;
    const querySql = calls[1]?.[0] as string;
    expect(querySql).toMatch(/SELECT \* FROM users LIMIT 1000$/);
  });
});

describe('DbProvider — mysql engine branches', () => {
  const MYSQL_CONFIG = {
    engine: 'mysql' as const,
    host: 'localhost',
    port: 3306,
    user: 'test',
    password: 'test',
    database: 'testdb',
    name: DB_TEST_IDS.sourceName,
  };

  it('getTableCount returns count using information_schema query', async () => {
    mockKnex.raw
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: 8 }] });

    const provider = new DbProvider(MYSQL_CONFIG);
    await provider.connect();
    const count = await provider.getTableCount();

    expect(count).toBe(8);
  });

  it('introspect queries tables via DATABASE() filter', async () => {
    mockKnex.raw
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ table_schema: 'testdb', table_name: DB_TEST_IDS.tableName }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const provider = new DbProvider(MYSQL_CONFIG);
    await provider.connect();

    const batches: DbSchemaBatch[] = [];
    for await (const batch of provider.introspect()) {
      batches.push(batch);
    }

    expect(batches).toHaveLength(1);
    expect(batches[0]?.tables).toHaveLength(1);

    const tablesSql = mockKnex.raw.mock.calls[1]?.[0] as string;
    expect(tablesSql).toContain('DATABASE()');
  });

  it('introspect queries columns via DATABASE() filter', async () => {
    mockKnex.raw
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{
          table_name: DB_TEST_IDS.tableName,
          column_name: DB_TEST_IDS.columnName,
          data_type: 'int',
          is_nullable: 'NO',
          column_default: null,
          ordinal_position: 1,
        }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const provider = new DbProvider(MYSQL_CONFIG);
    await provider.connect();

    const batches: DbSchemaBatch[] = [];
    for await (const batch of provider.introspect()) {
      batches.push(batch);
    }

    const columnsSql = mockKnex.raw.mock.calls[3]?.[0] as string;
    expect(columnsSql).toContain('DATABASE()');
  });

  it('introspect queries primary keys via CONSTRAINT_NAME = PRIMARY', async () => {
    mockKnex.raw
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ table_name: DB_TEST_IDS.tableName, column_name: DB_TEST_IDS.columnName }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const provider = new DbProvider(MYSQL_CONFIG);
    await provider.connect();

    const batches: DbSchemaBatch[] = [];
    for await (const batch of provider.introspect()) {
      batches.push(batch);
    }

    const pkSql = mockKnex.raw.mock.calls[2]?.[0] as string;
    expect(pkSql).toContain("CONSTRAINT_NAME = 'PRIMARY'");
  });

  it('introspect queries foreign keys via REFERENCED_TABLE_NAME IS NOT NULL', async () => {
    mockKnex.raw
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{
          table_name: DB_TEST_IDS.tableName2,
          column_name: DB_TEST_IDS.fkColumn,
          referenced_table: DB_TEST_IDS.tableName,
          referenced_column: DB_TEST_IDS.columnName,
        }],
      })
      .mockResolvedValueOnce({ rows: [] });

    const provider = new DbProvider(MYSQL_CONFIG);
    await provider.connect();

    const batches: DbSchemaBatch[] = [];
    for await (const batch of provider.introspect()) {
      batches.push(batch);
    }

    const fkSql = mockKnex.raw.mock.calls[4]?.[0] as string;
    expect(fkSql).toContain('REFERENCED_TABLE_NAME IS NOT NULL');
    expect(batches[0]?.foreignKeys).toHaveLength(1);
  });
});

describe('DbProvider — mssql engine branch', () => {
  const MSSQL_CONFIG = {
    engine: 'mssql' as const,
    host: 'localhost',
    port: 1433,
    user: 'test',
    password: 'test',
    database: 'testdb',
    name: DB_TEST_IDS.sourceName,
  };

  it('introspect queries tables via INFORMATION_SCHEMA.TABLES', async () => {
    mockKnex.raw
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ table_schema: 'dbo', table_name: DB_TEST_IDS.tableName }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const provider = new DbProvider(MSSQL_CONFIG);
    await provider.connect();

    const batches: DbSchemaBatch[] = [];
    for await (const batch of provider.introspect()) {
      batches.push(batch);
    }

    expect(batches).toHaveLength(1);
    expect(batches[0]?.tables).toHaveLength(1);

    const tablesSql = mockKnex.raw.mock.calls[1]?.[0] as string;
    expect(tablesSql).toContain('INFORMATION_SCHEMA.TABLES');
  });
});

describe('DbProvider — sqlite engine branch', () => {
  const SQLITE_CONFIG = {
    engine: 'sqlite' as const,
    host: '',
    port: 0,
    user: '',
    password: '',
    database: '/var/data/app.db',
    name: DB_TEST_IDS.sourceName,
  };

  it('introspect queries tables via sqlite_master', async () => {
    mockKnex.raw
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce([
        [{ table_schema: 'main', table_name: DB_TEST_IDS.tableName }],
        [],
      ])
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const provider = new DbProvider(SQLITE_CONFIG);
    await provider.connect();

    const batches: DbSchemaBatch[] = [];
    for await (const batch of provider.introspect()) {
      batches.push(batch);
    }

    expect(batches).toHaveLength(1);

    const tablesSql = mockKnex.raw.mock.calls[1]?.[0] as string;
    expect(tablesSql).toContain('sqlite_master');
  });
});

describe('DbProvider — introspect uses config.database as sourceName when config.name is falsy', () => {
  it('falls back to config.database when name is empty string', async () => {
    const { mapTableRow } = await import('../../../../src/adapters/db/mapper.js');

    mockKnex.raw
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ table_schema: 'public', table_name: DB_TEST_IDS.tableName }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const provider = new DbProvider({ ...DB_CONFIG, name: '' });
    await provider.connect();

    for await (const _batch of provider.introspect()) {
      // consume
    }

    expect(vi.mocked(mapTableRow)).toHaveBeenCalledWith(
      expect.anything(),
      DB_CONFIG.database,
    );
  });
});
