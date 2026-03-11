/* eslint-disable @typescript-eslint/unbound-method -- mock methods are safe in test assertions */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type pg from 'pg';
import { createBatch, createIssue, createEmptyBatch, TEST_IDS } from '../../fixtures/shared/test-constants.js';

// ─── Mock helpers ────────────────────────────────────────────────────────

function createMockClient() {
  return {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    release: vi.fn(),
  };
}

function createMockPool(client: ReturnType<typeof createMockClient>) {
  return {
    connect: vi.fn().mockResolvedValue(client),
    query: vi.fn().mockResolvedValue({ rows: [] }),
    end: vi.fn().mockResolvedValue(undefined),
  } as unknown as pg.Pool;
}

// ─── Module mocks ────────────────────────────────────────────────────────

vi.mock('../../../src/adapters/postgres/connection.js', () => ({
  createPool: vi.fn(),
}));

vi.mock('../../../src/adapters/postgres/schema.js', () => ({
  ensureSchema: vi.fn().mockResolvedValue(undefined),
}));

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let PostgresStorage: typeof import('../../../src/adapters/postgres/storage.js').PostgresStorage;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let createPool: typeof import('../../../src/adapters/postgres/connection.js').createPool;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let ensureSchema: typeof import('../../../src/adapters/postgres/schema.js').ensureSchema;

beforeEach(async () => {
  vi.clearAllMocks();
  const storageModule = await import('../../../src/adapters/postgres/storage.js');
  const connectionModule = await import('../../../src/adapters/postgres/connection.js');
  const schemaModule = await import('../../../src/adapters/postgres/schema.js');
  PostgresStorage = storageModule.PostgresStorage;
  createPool = connectionModule.createPool;
  ensureSchema = schemaModule.ensureSchema;
});

// ─── Helpers ─────────────────────────────────────────────────────────────

const DB_CONFIG = {
  host: 'localhost',
  port: 5432,
  user: 'test',
  password: 'test',
  database: 'test_db',
};

function filterCalls(mock: ReturnType<typeof vi.fn>, substring: string) {
  return mock.mock.calls.filter((c: unknown[]) => {
    const sql = c[0] as string;
    return sql.includes(substring);
  });
}

function getParams(calls: unknown[][], index: number): unknown[] {
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- index validated by toHaveLength before call
  return calls[index]![1] as unknown[];
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe('PostgresStorage', () => {
  let mockClient: ReturnType<typeof createMockClient>;
  let mockPool: pg.Pool;

  beforeEach(() => {
    mockClient = createMockClient();
    mockPool = createMockPool(mockClient);
    vi.mocked(createPool).mockReturnValue(mockPool);
  });

  function createStorage() {
    return new PostgresStorage(DB_CONFIG);
  }

  describe('constructor', () => {
    it('creates pool with config', () => {
      createStorage();
      expect(createPool).toHaveBeenCalledWith(DB_CONFIG);
    });

    it('has name "PostgreSQL"', () => {
      const storage = createStorage();
      expect(storage.name).toBe('PostgreSQL');
    });
  });

  describe('initialize', () => {
    it('calls ensureSchema with pool', async () => {
      const storage = createStorage();
      await storage.initialize();
      expect(ensureSchema).toHaveBeenCalledWith(mockPool);
    });
  });

  describe('saveBatch', () => {
    it('wraps operations in transaction', async () => {
      const storage = createStorage();
      await storage.saveBatch(createBatch());

      const calls = mockClient.query.mock.calls.map((c: unknown[]) => {
        const sql = c[0] as string;
        return sql.includes('BEGIN') ? 'BEGIN'
          : sql.includes('COMMIT') ? 'COMMIT'
          : sql.includes('ROLLBACK') ? 'ROLLBACK'
          : 'SQL';
      });

      expect(calls[0]).toBe('BEGIN');
      expect(calls[calls.length - 1]).toBe('COMMIT');
      expect(calls).not.toContain('ROLLBACK');
    });

    it('upserts each issue', async () => {
      const storage = createStorage();
      const issue1 = createIssue({ key: TEST_IDS.issueKey });
      const issue2 = createIssue({ key: TEST_IDS.issueKey2, id: TEST_IDS.issueId2 });
      const batch = createBatch({ issues: [issue1, issue2], comments: [], changelogs: [], worklogs: [], links: [] });

      await storage.saveBatch(batch);

      const inserts = filterCalls(mockClient.query, 'INSERT INTO issues');
      expect(inserts).toHaveLength(2);

      const params = getParams(inserts, 0);
      expect(params[0]).toBe(TEST_IDS.issueKey);
      expect(params[3]).toBe('Test issue summary');
    });

    it('deletes old related data before re-inserting', async () => {
      const storage = createStorage();
      await storage.saveBatch(createBatch());

      const deletes = filterCalls(mockClient.query, 'DELETE FROM');
      expect(deletes).toHaveLength(4);

      const tables = deletes.map((c: unknown[]) => {
        const match = /DELETE FROM (\w+)/.exec(c[0] as string);
        return match?.[1];
      });

      expect(tables).toContain('issue_comments');
      expect(tables).toContain('issue_changelogs');
      expect(tables).toContain('issue_worklogs');
      expect(tables).toContain('issue_links');
    });

    it('inserts comments', async () => {
      const storage = createStorage();
      await storage.saveBatch(createBatch());

      const inserts = filterCalls(mockClient.query, 'INSERT INTO issue_comments');
      expect(inserts).toHaveLength(1);

      const params = getParams(inserts, 0);
      expect(params[0]).toBe(TEST_IDS.issueKey);
      expect(params[1]).toBe(TEST_IDS.commentId);
    });

    it('inserts changelogs', async () => {
      const storage = createStorage();
      await storage.saveBatch(createBatch());

      const inserts = filterCalls(mockClient.query, 'INSERT INTO issue_changelogs');
      expect(inserts).toHaveLength(1);

      const params = getParams(inserts, 0);
      expect(params[2]).toBe('status');
    });

    it('inserts worklogs', async () => {
      const storage = createStorage();
      await storage.saveBatch(createBatch());

      const inserts = filterCalls(mockClient.query, 'INSERT INTO issue_worklogs');
      expect(inserts).toHaveLength(1);

      const params = getParams(inserts, 0);
      expect(params[2]).toBe('2h');
      expect(params[3]).toBe(7200);
    });

    it('inserts links', async () => {
      const storage = createStorage();
      await storage.saveBatch(createBatch());

      const inserts = filterCalls(mockClient.query, 'INSERT INTO issue_links');
      expect(inserts).toHaveLength(1);

      const params = getParams(inserts, 0);
      expect(params[0]).toBe(TEST_IDS.issueKey);
      expect(params[1]).toBe(TEST_IDS.issueKey2);
      expect(params[3]).toBe('outward');
    });

    it('skips delete when batch has no issues', async () => {
      const storage = createStorage();
      await storage.saveBatch(createEmptyBatch());

      const deletes = filterCalls(mockClient.query, 'DELETE FROM');
      expect(deletes).toHaveLength(0);
    });

    it('serializes customFields and rawJson as JSON', async () => {
      const storage = createStorage();
      const issue = createIssue({
        customFields: { customfield_123: 'value' },
        rawJson: { key: 'TEST-1', fields: {} },
      });
      const batch = createBatch({ issues: [issue], comments: [], changelogs: [], worklogs: [], links: [] });

      await storage.saveBatch(batch);

      const inserts = filterCalls(mockClient.query, 'INSERT INTO issues');
      const params = getParams(inserts, 0);
      // customFields at index 22, rawJson at index 23
      expect(params[22]).toBe(JSON.stringify({ customfield_123: 'value' }));
      expect(params[23]).toBe(JSON.stringify({ key: 'TEST-1', fields: {} }));
    });

    it('rolls back transaction on error', async () => {
      const storage = createStorage();
      let callCount = 0;
      mockClient.query.mockImplementation(() => {
        callCount++;
        if (callCount === 2) {
          return Promise.reject(new Error('DB insert failed'));
        }
        return Promise.resolve({ rows: [] });
      });

      await expect(storage.saveBatch(createBatch())).rejects.toThrow('DB insert failed');

      const rollbacks = filterCalls(mockClient.query, 'ROLLBACK');
      expect(rollbacks).toHaveLength(1);
    });

    it('always releases client even on error', async () => {
      const storage = createStorage();
      mockClient.query.mockRejectedValueOnce(new Error('BEGIN failed'));

      await expect(storage.saveBatch(createBatch())).rejects.toThrow();
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('getLastUpdated', () => {
    it('returns last updated timestamp for project', async () => {
      const storage = createStorage();
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [{ last_updated: '2025-01-16T12:00:00.000+0000' }],
      } as never);

      const result = await storage.getLastUpdated(TEST_IDS.projectKey);

      expect(result).toBe('2025-01-16T12:00:00.000+0000');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('MAX(updated)'),
        [TEST_IDS.projectKey],
      );
    });

    it('returns null when no issues found', async () => {
      const storage = createStorage();
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [{ last_updated: null }],
      } as never);

      const result = await storage.getLastUpdated('EMPTY');
      expect(result).toBeNull();
    });

    it('returns null when rows are empty', async () => {
      const storage = createStorage();
      vi.mocked(mockPool.query).mockResolvedValueOnce({ rows: [] } as never);

      const result = await storage.getLastUpdated('NONE');
      expect(result).toBeNull();
    });
  });

  describe('query', () => {
    it('executes raw SQL and returns rows', async () => {
      const storage = createStorage();
      const mockRows = [{ issue_key: 'TEST-1', summary: 'Test' }];
      vi.mocked(mockPool.query).mockResolvedValueOnce({ rows: mockRows } as never);

      const result = await storage.query('SELECT * FROM issues WHERE project_key = $1', ['TEST']);

      expect(result.rows).toEqual(mockRows);
      expect(mockPool.query).toHaveBeenCalledWith(
        'SELECT * FROM issues WHERE project_key = $1',
        ['TEST'],
      );
    });
  });

  describe('close', () => {
    it('ends the pool', async () => {
      const storage = createStorage();
      await storage.close();
      expect(mockPool.end).toHaveBeenCalled();
    });
  });
});
