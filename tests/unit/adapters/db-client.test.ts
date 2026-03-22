import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('knex', () => ({
  default: vi.fn(() => ({ mock: true })),
}));

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let createKnexClient: typeof import('../../../src/adapters/db/client.js').createKnexClient;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let knex: typeof import('knex').default;

beforeEach(async () => {
  vi.clearAllMocks();

  const knexModule = await import('knex');
  knex = knexModule.default;

  const clientModule = await import('../../../src/adapters/db/client.js');
  createKnexClient = clientModule.createKnexClient;
});

const BASE_CONFIG = {
  engine: 'postgresql' as const,
  host: 'localhost',
  port: 5432,
  user: 'test',
  password: 'test',
  database: 'testdb',
  name: 'test-source',
};

describe('createKnexClient', () => {
  it('creates pg client for postgresql engine', () => {
    createKnexClient(BASE_CONFIG);

    expect(knex).toHaveBeenCalledWith(
      expect.objectContaining({ client: 'pg' }),
    );
  });

  it('creates mysql2 client for mysql engine', () => {
    createKnexClient({ ...BASE_CONFIG, engine: 'mysql' as const });

    expect(knex).toHaveBeenCalledWith(
      expect.objectContaining({ client: 'mysql2' }),
    );
  });

  it('creates better-sqlite3 client for sqlite engine', () => {
    createKnexClient({ ...BASE_CONFIG, engine: 'sqlite' as const });

    expect(knex).toHaveBeenCalledWith(
      expect.objectContaining({ client: 'better-sqlite3' }),
    );
  });

  it('configures pool with max 2 connections', () => {
    createKnexClient(BASE_CONFIG);

    const callArgs = vi.mocked(knex).mock.calls[0]?.[0] as Record<string, unknown>;
    const pool = callArgs['pool'] as Record<string, unknown>;
    expect(pool['max']).toBe(2);
  });

  it('sets SSL for remote hosts', () => {
    createKnexClient({ ...BASE_CONFIG, host: 'db.example.com' });

    const callArgs = vi.mocked(knex).mock.calls[0]?.[0] as Record<string, unknown>;
    const connection = callArgs['connection'] as Record<string, unknown>;
    expect(connection['ssl']).toEqual({ rejectUnauthorized: false });
  });

  it('disables SSL for localhost', () => {
    createKnexClient({ ...BASE_CONFIG, host: 'localhost' });

    const callArgs = vi.mocked(knex).mock.calls[0]?.[0] as Record<string, unknown>;
    const connection = callArgs['connection'] as Record<string, unknown>;
    expect(connection['ssl']).toBe(false);
  });

  it('disables SSL for 127.0.0.1', () => {
    createKnexClient({ ...BASE_CONFIG, host: '127.0.0.1' });

    const callArgs = vi.mocked(knex).mock.calls[0]?.[0] as Record<string, unknown>;
    const connection = callArgs['connection'] as Record<string, unknown>;
    expect(connection['ssl']).toBe(false);
  });

  it('configures sqlite with readonly and single connection', () => {
    createKnexClient({ ...BASE_CONFIG, engine: 'sqlite' as const, database: '/path/to/db.sqlite' });

    const callArgs = vi.mocked(knex).mock.calls[0]?.[0] as Record<string, unknown>;
    const connection = callArgs['connection'] as Record<string, unknown>;
    const pool = callArgs['pool'] as Record<string, unknown>;

    expect(connection['filename']).toBe('/path/to/db.sqlite');
    expect((connection['options'] as Record<string, unknown>)['readonly']).toBe(true);
    expect(pool['max']).toBe(1);
  });

  it('includes afterCreate hook for postgresql', () => {
    createKnexClient(BASE_CONFIG);

    const callArgs = vi.mocked(knex).mock.calls[0]?.[0] as Record<string, unknown>;
    const pool = callArgs['pool'] as Record<string, unknown>;
    expect(pool['afterCreate']).toBeTypeOf('function');
  });

  describe('afterCreate hook (security)', () => {
    it('sets read-only mode and statement_timeout for postgresql', () => {
      createKnexClient(BASE_CONFIG);

      const callArgs = vi.mocked(knex).mock.calls[0]?.[0] as Record<string, unknown>;
      const pool = callArgs['pool'] as Record<string, unknown>;
      const afterCreate = pool['afterCreate'] as (
        conn: { query: (sql: string, cb: (err: unknown) => void) => void },
        done: (err: unknown, conn: unknown) => void,
      ) => void;

      const queries: string[] = [];
      const mockConn = {
        query: (sql: string, cb: (err: unknown) => void) => {
          queries.push(sql);
          cb(null);
        },
      };
      const done = vi.fn();

      afterCreate(mockConn, done);

      expect(queries).toContain('SET default_transaction_read_only = true');
      expect(queries[1]).toContain('SET statement_timeout');
      expect(done).toHaveBeenCalledWith(null, mockConn);
    });

    it('calls done with error if first SET fails for postgresql', () => {
      createKnexClient(BASE_CONFIG);

      const callArgs = vi.mocked(knex).mock.calls[0]?.[0] as Record<string, unknown>;
      const pool = callArgs['pool'] as Record<string, unknown>;
      const afterCreate = pool['afterCreate'] as (
        conn: { query: (sql: string, cb: (err: unknown) => void) => void },
        done: (err: unknown, conn: unknown) => void,
      ) => void;

      const mockError = new Error('SET failed');
      const mockConn = {
        query: (_sql: string, cb: (err: unknown) => void) => {
          cb(mockError);
        },
      };
      const done = vi.fn();

      afterCreate(mockConn, done);

      expect(done).toHaveBeenCalledWith(mockError, mockConn);
    });

    it('sets read-only and max_execution_time for mysql', () => {
      createKnexClient({ ...BASE_CONFIG, engine: 'mysql' as const });

      const callArgs = vi.mocked(knex).mock.calls[0]?.[0] as Record<string, unknown>;
      const pool = callArgs['pool'] as Record<string, unknown>;
      const afterCreate = pool['afterCreate'] as (
        conn: { query: (sql: string, cb: (err: unknown) => void) => void },
        done: (err: unknown, conn: unknown) => void,
      ) => void;

      const queries: string[] = [];
      const mockConn = {
        query: (sql: string, cb: (err: unknown) => void) => {
          queries.push(sql);
          cb(null);
        },
      };
      const done = vi.fn();

      afterCreate(mockConn, done);

      expect(queries).toContain('SET SESSION TRANSACTION READ ONLY');
      expect(queries[1]).toContain('SET SESSION max_execution_time');
      expect(done).toHaveBeenCalledWith(null, mockConn);
    });

    it('calls done immediately for other engines', () => {
      createKnexClient({ ...BASE_CONFIG, engine: 'mssql' as const });

      const callArgs = vi.mocked(knex).mock.calls[0]?.[0] as Record<string, unknown>;
      const pool = callArgs['pool'] as Record<string, unknown>;
      const afterCreate = pool['afterCreate'] as (
        conn: { query: (sql: string, cb: (err: unknown) => void) => void },
        done: (err: unknown, conn: unknown) => void,
      ) => void;

      const mockConn = { query: vi.fn() };
      const done = vi.fn();

      afterCreate(mockConn, done);

      expect(mockConn.query).not.toHaveBeenCalled();
      expect(done).toHaveBeenCalledWith(null, mockConn);
    });
  });
});
