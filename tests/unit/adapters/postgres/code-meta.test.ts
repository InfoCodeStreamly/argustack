import { describe, it, expect, beforeEach, vi } from 'vitest';

type QueryFn = (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;

const hoisted = vi.hoisted(() => {
  const query = vi.fn<QueryFn>();
  const clientQuery = vi.fn<QueryFn>();
  const clientRelease = vi.fn();
  const connect = vi.fn(() => Promise.resolve({
    query: clientQuery,
    release: clientRelease,
  }));
  const end = vi.fn().mockResolvedValue(undefined);
  return { query, connect, clientQuery, clientRelease, end };
});
const mockQuery = hoisted.query;
const mockConnect = hoisted.connect;
const mockClientQuery = hoisted.clientQuery;
const mockClientRelease = hoisted.clientRelease;
const mockEnd = hoisted.end;

vi.mock('pg', () => {
  class FakePool {
    query = hoisted.query;
    connect = hoisted.connect;
    end = hoisted.end;
  }
  return { default: { Pool: FakePool } };
});

import { PostgresStorage } from '../../../../src/adapters/postgres/index.js';
import { createCodeProject, createIndexStats, CODE_TEST_IDS } from '../../../fixtures/shared/test-constants.js';

const dbConfig = {
  host: 'localhost',
  port: 5432,
  user: 'argustack',
  password: 'x',
  database: 'argustack',
};

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [] });
  mockClientQuery.mockReset();
  mockClientQuery.mockResolvedValue({ rows: [] });
  mockClientRelease.mockReset();
});

function queryCall(index: number): { sql: string; params: unknown[] } {
  const call = mockQuery.mock.calls[index];
  if (!call) {
    throw new Error(`mockQuery has no call at index ${String(index)}`);
  }
  const [sql, params] = call;
  return { sql, params: params ?? [] };
}

function queryCallSql(index: number): string {
  return queryCall(index).sql;
}

describe('PostgresStorage — ICodeMetaStore', () => {
  describe('registerProject', () => {
    it('issues INSERT ON CONFLICT DO UPDATE', async () => {
      const storage = new PostgresStorage(dbConfig);
      await storage.registerProject(createCodeProject());

      const { sql, params } = queryCall(0);
      expect(sql).toMatch(/INSERT INTO code_projects/);
      expect(sql).toMatch(/ON CONFLICT \(id\) DO UPDATE/);
      expect(params[0]).toBe(CODE_TEST_IDS.projectA);
    });
  });

  describe('unregisterProject', () => {
    it('issues DELETE for jobs and projects', async () => {
      const storage = new PostgresStorage(dbConfig);
      await storage.unregisterProject(CODE_TEST_IDS.projectA);

      expect(queryCallSql(0)).toMatch(/DELETE FROM code_index_jobs/);
      expect(queryCallSql(1)).toMatch(/DELETE FROM code_projects/);
    });
  });

  describe('listProjects / getProjectById / getProjectByRoot', () => {
    it('listProjects returns rows mapped to CodeProject', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: CODE_TEST_IDS.projectA,
            name: CODE_TEST_IDS.projectName,
            root_path: CODE_TEST_IDS.projectRoot,
            language: 'typescript',
            layer_config: null,
            excludes: null,
            created_at: null,
            last_indexed_at: null,
          },
        ],
      });
      const storage = new PostgresStorage(dbConfig);
      const projects = await storage.listProjects();

      expect(projects).toHaveLength(1);
      expect(projects[0]?.id).toBe(CODE_TEST_IDS.projectA);
      expect(projects[0]?.root).toBe(CODE_TEST_IDS.projectRoot);
    });

    it('getProjectByRoot returns null when no match', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const storage = new PostgresStorage(dbConfig);
      const result = await storage.getProjectByRoot('/nowhere');
      expect(result).toBeNull();
    });
  });

  describe('upsertFileHashes', () => {
    it('opens a transaction and INSERTs each hash', async () => {
      const storage = new PostgresStorage(dbConfig);
      await storage.upsertFileHashes(CODE_TEST_IDS.projectA, [
        { path: 'a.ts', hash: 'h1' },
        { path: 'b.ts', hash: 'h2' },
      ]);

      const sqls = mockClientQuery.mock.calls.map((c) => c[0]);
      expect(sqls[0]).toBe('BEGIN');
      expect(sqls.some((s) => s.includes('INSERT INTO code_files'))).toBe(true);
      expect(sqls[sqls.length - 1]).toBe('COMMIT');
      expect(mockClientRelease).toHaveBeenCalled();
    });

    it('is no-op for empty hash array', async () => {
      mockConnect.mockClear();
      const storage = new PostgresStorage(dbConfig);
      await storage.upsertFileHashes(CODE_TEST_IDS.projectA, []);
      expect(mockConnect).not.toHaveBeenCalled();
    });
  });

  describe('index job lifecycle', () => {
    it('startIndexJob INSERTs and returns id', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ id: '42' }] });
      const storage = new PostgresStorage(dbConfig);
      const id = await storage.startIndexJob(CODE_TEST_IDS.projectA, 'incremental');
      expect(id).toBe(42);
      expect(queryCallSql(0)).toMatch(/INSERT INTO code_index_jobs/);
    });

    it('completeIndexJob UPDATEs status to completed with stats', async () => {
      const storage = new PostgresStorage(dbConfig);
      await storage.completeIndexJob(7, createIndexStats());
      const sql = queryCallSql(0);
      expect(sql).toMatch(/UPDATE code_index_jobs/);
      expect(sql).toMatch(/status = 'completed'/);
    });

    it('failIndexJob UPDATEs status to failed with error', async () => {
      const storage = new PostgresStorage(dbConfig);
      await storage.failIndexJob(7, 'boom');
      const sql = queryCallSql(0);
      expect(sql).toMatch(/status = 'failed'/);
    });

    it('getLatestJob returns mapped IndexJob or null', async () => {
      const date = new Date('2026-01-01T00:00:00Z');
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 5,
            project_id: CODE_TEST_IDS.projectA,
            type: 'full',
            status: 'completed',
            started_at: date,
            completed_at: date,
            stats: createIndexStats(),
            error: null,
          },
        ],
      });
      const storage = new PostgresStorage(dbConfig);
      const job = await storage.getLatestJob(CODE_TEST_IDS.projectA);
      expect(job?.id).toBe(5);
      expect(job?.status).toBe('completed');
    });
  });

  describe('advisory locks', () => {
    it('tryAcquireLock uses md5 + bit cast (not hashtext)', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ locked: true }] });
      const storage = new PostgresStorage(dbConfig);
      const ok = await storage.tryAcquireLock(CODE_TEST_IDS.projectA);
      expect(ok).toBe(true);
      const sql = queryCallSql(0);
      expect(sql).toMatch(/pg_try_advisory_lock/);
      expect(sql).toMatch(/md5/);
      expect(sql).not.toMatch(/hashtext/);
    });

    it('tryAcquireLock returns false when lock unavailable', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ locked: false }] });
      const storage = new PostgresStorage(dbConfig);
      const ok = await storage.tryAcquireLock(CODE_TEST_IDS.projectA);
      expect(ok).toBe(false);
    });

    it('releaseLock calls pg_advisory_unlock', async () => {
      const storage = new PostgresStorage(dbConfig);
      await storage.releaseLock(CODE_TEST_IDS.projectA);
      expect(queryCallSql(0)).toMatch(/pg_advisory_unlock/);
    });
  });

  describe('close', () => {
    it('ends the pool', async () => {
      const storage = new PostgresStorage(dbConfig);
      await storage.close();
      expect(mockEnd).toHaveBeenCalled();
    });
  });
});
