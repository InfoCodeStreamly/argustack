/* eslint-disable @typescript-eslint/unbound-method -- mock methods are safe in test assertions */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type pg from 'pg';
import {
  createBatch, createIssue, createEmptyBatch, TEST_IDS,
  createCommit, createCommitBatch, GIT_TEST_IDS,
  createGitHubBatch, createPullRequest, GITHUB_TEST_IDS,
  createRelease,
  createDbSchemaBatch, DB_TEST_IDS,
} from '../../fixtures/shared/test-constants.js';

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
        rawJson: { key: TEST_IDS.issueKey, fields: {} },
      });
      const batch = createBatch({ issues: [issue], comments: [], changelogs: [], worklogs: [], links: [] });

      await storage.saveBatch(batch);

      const inserts = filterCalls(mockClient.query, 'INSERT INTO issues');
      const params = getParams(inserts, 0);
      // customFields at index 27, rawJson at index 28 (after assignee_id, reporter_id, original_estimate, remaining_estimate, time_spent)
      expect(params[27]).toBe(JSON.stringify({ customfield_123: 'value' }));
      expect(params[28]).toBe(JSON.stringify({ key: TEST_IDS.issueKey, fields: {} }));
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
      const mockRows = [{ issue_key: TEST_IDS.issueKey, summary: 'Test' }];
      vi.mocked(mockPool.query).mockResolvedValueOnce({ rows: mockRows } as never);

      const result = await storage.query('SELECT * FROM issues WHERE project_key = $1', ['TEST']);

      expect(result.rows).toEqual(mockRows);
      expect(mockPool.query).toHaveBeenCalledWith(
        'SELECT * FROM issues WHERE project_key = $1',
        ['TEST'],
      );
    });
  });

  describe('saveCommitBatch', () => {
    it('wraps operations in transaction', async () => {
      const storage = createStorage();
      const batch = createCommitBatch();
      await storage.saveCommitBatch(batch);

      const calls = mockClient.query.mock.calls.map((c: unknown[]) => {
        const sql = c[0] as string;
        return sql.includes('BEGIN') ? 'BEGIN'
          : sql.includes('COMMIT') ? 'COMMIT'
          : sql.includes('ROLLBACK') ? 'ROLLBACK'
          : 'SQL';
      });

      expect(calls[0]).toBe('BEGIN');
      expect(calls[calls.length - 1]).toBe('COMMIT');
    });

    it('upserts each commit', async () => {
      const storage = createStorage();
      const commit1 = createCommit({ hash: GIT_TEST_IDS.commitHash });
      const commit2 = createCommit({ hash: GIT_TEST_IDS.commitHash2 });
      const batch = createCommitBatch({ commits: [commit1, commit2], files: [], issueRefs: [] });
      await storage.saveCommitBatch(batch);

      const inserts = filterCalls(mockClient.query, 'INSERT INTO commits');
      expect(inserts).toHaveLength(2);
    });

    it('inserts commit files', async () => {
      const storage = createStorage();
      await storage.saveCommitBatch(createCommitBatch());

      const inserts = filterCalls(mockClient.query, 'INSERT INTO commit_files');
      expect(inserts).toHaveLength(1);

      const params = getParams(inserts, 0);
      expect(params[0]).toBe(GIT_TEST_IDS.commitHash);
      expect(params[1]).toBe('src/login.ts');
    });

    it('inserts issue refs with ON CONFLICT DO NOTHING', async () => {
      const storage = createStorage();
      await storage.saveCommitBatch(createCommitBatch());

      const inserts = filterCalls(mockClient.query, 'INSERT INTO commit_issue_refs');
      expect(inserts).toHaveLength(1);

      const sql = inserts[0]?.[0] as string;
      expect(sql).toContain('ON CONFLICT DO NOTHING');
    });

    it('deletes old files and refs before re-inserting', async () => {
      const storage = createStorage();
      await storage.saveCommitBatch(createCommitBatch());

      const deleteFiles = filterCalls(mockClient.query, 'DELETE FROM commit_files');
      const deleteRefs = filterCalls(mockClient.query, 'DELETE FROM commit_issue_refs');
      expect(deleteFiles).toHaveLength(1);
      expect(deleteRefs).toHaveLength(1);
    });

    it('rolls back on error', async () => {
      const storage = createStorage();
      let callCount = 0;
      mockClient.query.mockImplementation(() => {
        callCount++;
        if (callCount === 2) {
          return Promise.reject(new Error('DB error'));
        }
        return Promise.resolve({ rows: [] });
      });

      await expect(storage.saveCommitBatch(createCommitBatch())).rejects.toThrow('DB error');

      const rollbacks = filterCalls(mockClient.query, 'ROLLBACK');
      expect(rollbacks).toHaveLength(1);
    });
  });

  describe('getLastCommitDate', () => {
    it('returns last commit date for repo', async () => {
      const storage = createStorage();
      const date = new Date('2025-01-15T10:00:00.000Z');
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [{ last_date: date }],
      } as never);

      const result = await storage.getLastCommitDate(GIT_TEST_IDS.repoPath);

      expect(result).toEqual(date);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('MAX(committed_at)'),
        [GIT_TEST_IDS.repoPath],
      );
    });

    it('returns null when no commits', async () => {
      const storage = createStorage();
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [{ last_date: null }],
      } as never);

      const result = await storage.getLastCommitDate(GIT_TEST_IDS.repoPath);
      expect(result).toBeNull();
    });
  });

  describe('saveGitHubBatch', () => {
    it('wraps operations in transaction', async () => {
      const storage = createStorage();
      await storage.saveGitHubBatch(createGitHubBatch());

      const calls = mockClient.query.mock.calls.map((c: unknown[]) => {
        const sql = c[0] as string;
        return sql.includes('BEGIN') ? 'BEGIN'
          : sql.includes('COMMIT') ? 'COMMIT'
          : 'SQL';
      });

      expect(calls[0]).toBe('BEGIN');
      expect(calls[calls.length - 1]).toBe('COMMIT');
    });

    it('upserts pull requests', async () => {
      const storage = createStorage();
      await storage.saveGitHubBatch(createGitHubBatch());

      const inserts = filterCalls(mockClient.query, 'INSERT INTO pull_requests');
      expect(inserts).toHaveLength(1);

      const params = getParams(inserts, 0);
      expect(params[0]).toBe(GITHUB_TEST_IDS.prNumber);
      expect(params[1]).toBe(GITHUB_TEST_IDS.repoFullName);
    });

    it('inserts reviews, comments, files, and issue refs', async () => {
      const storage = createStorage();
      await storage.saveGitHubBatch(createGitHubBatch());

      expect(filterCalls(mockClient.query, 'INSERT INTO pr_reviews')).toHaveLength(1);
      expect(filterCalls(mockClient.query, 'INSERT INTO pr_comments')).toHaveLength(1);
      expect(filterCalls(mockClient.query, 'INSERT INTO pr_files')).toHaveLength(1);
      expect(filterCalls(mockClient.query, 'INSERT INTO pr_issue_refs')).toHaveLength(1);
    });

    it('deletes old related data before re-inserting', async () => {
      const storage = createStorage();
      await storage.saveGitHubBatch(createGitHubBatch());

      expect(filterCalls(mockClient.query, 'DELETE FROM pr_reviews')).toHaveLength(1);
      expect(filterCalls(mockClient.query, 'DELETE FROM pr_comments')).toHaveLength(1);
      expect(filterCalls(mockClient.query, 'DELETE FROM pr_files')).toHaveLength(1);
      expect(filterCalls(mockClient.query, 'DELETE FROM pr_issue_refs')).toHaveLength(1);
    });

    it('serializes rawJson as JSON', async () => {
      const storage = createStorage();
      const batch = createGitHubBatch();
      batch.pullRequests[0] = createPullRequest({ rawJson: { key: 'val' } });
      await storage.saveGitHubBatch(batch);

      const inserts = filterCalls(mockClient.query, 'INSERT INTO pull_requests');
      const params = getParams(inserts, 0);
      expect(params[18]).toBe(JSON.stringify({ key: 'val' }));
    });
  });

  describe('getLastPrUpdated', () => {
    it('returns last PR updated date', async () => {
      const storage = createStorage();
      const date = new Date('2025-01-12T14:00:00.000Z');
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [{ last_updated: date }],
      } as never);

      const result = await storage.getLastPrUpdated(GITHUB_TEST_IDS.repoFullName);
      expect(result).toEqual(date);
    });

    it('returns null when no PRs found', async () => {
      const storage = createStorage();
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [{ last_updated: null }],
      } as never);

      const result = await storage.getLastPrUpdated(GITHUB_TEST_IDS.repoFullName);
      expect(result).toBeNull();
    });
  });

  describe('saveReleases', () => {
    it('upserts each release in a transaction', async () => {
      const storage = createStorage();
      await storage.saveReleases([createRelease()]);

      const calls = mockClient.query.mock.calls.map((c: unknown[]) => {
        const sql = c[0] as string;
        return sql.includes('BEGIN') ? 'BEGIN'
          : sql.includes('COMMIT') ? 'COMMIT'
          : 'SQL';
      });

      expect(calls[0]).toBe('BEGIN');
      expect(calls[calls.length - 1]).toBe('COMMIT');

      const inserts = filterCalls(mockClient.query, 'INSERT INTO releases');
      expect(inserts).toHaveLength(1);
    });

    it('serializes rawJson', async () => {
      const storage = createStorage();
      await storage.saveReleases([createRelease({ rawJson: { tag: 'v1' } })]);

      const inserts = filterCalls(mockClient.query, 'INSERT INTO releases');
      const params = getParams(inserts, 0);
      expect(params[10]).toBe(JSON.stringify({ tag: 'v1' }));
    });
  });

  describe('saveDbSchemaBatch', () => {
    it('inserts tables and columns in a transaction', async () => {
      const storage = createStorage();
      await storage.saveDbSchemaBatch(createDbSchemaBatch(), DB_TEST_IDS.sourceName);

      const tableInserts = filterCalls(mockClient.query, 'INSERT INTO db_tables');
      const columnInserts = filterCalls(mockClient.query, 'INSERT INTO db_columns');
      expect(tableInserts).toHaveLength(1);
      expect(columnInserts).toHaveLength(1);
    });

    it('inserts foreign keys', async () => {
      const storage = createStorage();
      await storage.saveDbSchemaBatch(createDbSchemaBatch(), DB_TEST_IDS.sourceName);

      const fkInserts = filterCalls(mockClient.query, 'INSERT INTO db_foreign_keys');
      expect(fkInserts).toHaveLength(1);
    });

    it('inserts indexes', async () => {
      const storage = createStorage();
      await storage.saveDbSchemaBatch(createDbSchemaBatch(), DB_TEST_IDS.sourceName);

      const idxInserts = filterCalls(mockClient.query, 'INSERT INTO db_indexes');
      expect(idxInserts).toHaveLength(1);
    });

    it('rolls back on error', async () => {
      const storage = createStorage();
      let callCount = 0;
      mockClient.query.mockImplementation(() => {
        callCount++;
        if (callCount === 2) {
          return Promise.reject(new Error('DB error'));
        }
        return Promise.resolve({ rows: [] });
      });

      await expect(storage.saveDbSchemaBatch(createDbSchemaBatch(), DB_TEST_IDS.sourceName)).rejects.toThrow('DB error');

      const rollbacks = filterCalls(mockClient.query, 'ROLLBACK');
      expect(rollbacks).toHaveLength(1);
    });
  });

  describe('deleteDbSchema', () => {
    it('deletes from all db_* tables for given source', async () => {
      const storage = createStorage();
      await storage.deleteDbSchema(DB_TEST_IDS.sourceName);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM db_indexes'),
        [DB_TEST_IDS.sourceName],
      );
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM db_foreign_keys'),
        [DB_TEST_IDS.sourceName],
      );
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM db_columns'),
        [DB_TEST_IDS.sourceName],
      );
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM db_tables'),
        [DB_TEST_IDS.sourceName],
      );
    });
  });

  describe('embedding methods', () => {
    it('getUnembeddedIssueKeys returns keys', async () => {
      const storage = createStorage();
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [{ issue_key: TEST_IDS.issueKey }, { issue_key: TEST_IDS.issueKey2 }],
      } as never);

      const keys = await storage.getUnembeddedIssueKeys(10);
      expect(keys).toEqual([TEST_IDS.issueKey, TEST_IDS.issueKey2]);
    });

    it('saveEmbedding updates issue with vector', async () => {
      const storage = createStorage();
      vi.mocked(mockPool.query).mockResolvedValueOnce({ rows: [] } as never);

      await storage.saveEmbedding(TEST_IDS.issueKey, [0.1, 0.2, 0.3]);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE issues SET embedding'),
        ['[0.1,0.2,0.3]', TEST_IDS.issueKey],
      );
    });

    it('semanticSearch returns ranked results', async () => {
      const storage = createStorage();
      vi.mocked(mockPool.query).mockResolvedValueOnce({
        rows: [{ issue_key: TEST_IDS.issueKey, similarity: 0.95 }],
      } as never);

      const results = await storage.semanticSearch([0.1, 0.2], 5);
      expect(results).toHaveLength(1);
      expect(results[0]?.issueKey).toBe(TEST_IDS.issueKey);
      expect(results[0]?.similarity).toBe(0.95);
    });

    it('semanticSearch applies threshold filter', async () => {
      const storage = createStorage();
      vi.mocked(mockPool.query).mockResolvedValueOnce({ rows: [] } as never);

      await storage.semanticSearch([0.1, 0.2], 5, 0.8);

      const call = vi.mocked(mockPool.query).mock.calls[0];
      const sql = call?.[0] ?? '';
      expect(sql).toContain('>= 0.8');
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
