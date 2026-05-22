/**
 * Unit tests for {@link PostgresCommitStorage}.
 * Mocks `pg.Pool` and inspects SQL/params per method.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type pg from 'pg';
import { PostgresCommitStorage } from '../../../../src/adapters/postgres/storage-commits.js';
import type { CommitBatch } from '../../../../src/core/types/git.js';
import { TEST_IDS } from '../../../fixtures/shared/test-constants.js';

interface MockClient {
  query: ReturnType<typeof vi.fn<(sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>>>;
  release: ReturnType<typeof vi.fn>;
}
interface MockPool { query: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn>; }

const WS = 'ws-test';

function emptyBatch(): CommitBatch {
  return { commits: [], files: [], issueRefs: [] };
}

function commitBatch(): CommitBatch {
  return {
    commits: [{
      hash: 'a'.repeat(40), message: 'first', author: 'alice', email: 'a@x', committedAt: '2025-01-01T00:00:00Z',
      parents: [], repoPath: '/repo',
    }],
    files: [{ commitHash: 'a'.repeat(40), filePath: 'README.md', status: 'modified', additions: 1, deletions: 0 }],
    issueRefs: [{ commitHash: 'a'.repeat(40), issueKey: TEST_IDS.issueKey }],
  };
}

let client: MockClient;
let pool: MockPool;
let storage: PostgresCommitStorage;

beforeEach(() => {
  client = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }), release: vi.fn() };
  pool = {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
    connect: vi.fn().mockResolvedValue(client),
  };
  storage = new PostgresCommitStorage(pool as unknown as pg.Pool);
});

describe('saveCommitBatch', () => {
  it('opens transaction, upserts commits + files + refs, commits', async () => {
    await storage.saveCommitBatch(WS, commitBatch());

    const sqls = client.query.mock.calls.map((c) => c[0]);
    expect(sqls[0]).toBe('BEGIN');
    expect(sqls).toContain('COMMIT');
    expect(sqls.some((s) => s.includes('INSERT INTO commits'))).toBe(true);
    expect(sqls.some((s) => s.includes('INSERT INTO commit_files'))).toBe(true);
    expect(sqls.some((s) => s.includes('INSERT INTO commit_issue_refs'))).toBe(true);
  });

  it('rolls back when commit insert throws', async () => {
    client.query.mockImplementation(async (sql: string) => {
      await Promise.resolve();
      if (sql.includes('INSERT INTO commits')) {
        throw new Error('boom');
      }
      return { rows: [], rowCount: 1 };
    });

    await expect(storage.saveCommitBatch(WS, commitBatch())).rejects.toThrow('boom');

    const sqls = client.query.mock.calls.map((c) => c[0]);
    expect(sqls).toContain('ROLLBACK');
  });

  it('skips child-table deletes when batch is empty', async () => {
    await storage.saveCommitBatch(WS, emptyBatch());

    const sqls = client.query.mock.calls.map((c) => c[0]);
    expect(sqls.some((s) => s.includes('DELETE FROM commit_files'))).toBe(false);
  });
});

describe('getLastCommitDate', () => {
  it('returns null when no rows', async () => {
    pool.query.mockResolvedValue({ rows: [{ last_date: null }] });

    expect(await storage.getLastCommitDate(WS, '/repo')).toBeNull();
  });

  it('returns the MAX(committed_at) Date for a repo', async () => {
    const date = new Date('2025-03-01T00:00:00Z');
    pool.query.mockResolvedValue({ rows: [{ last_date: date }] });

    expect(await storage.getLastCommitDate(WS, '/repo')).toBe(date);
  });

  it('binds workspace_id and repo_path', async () => {
    pool.query.mockResolvedValue({ rows: [] });

    await storage.getLastCommitDate(WS, '/repo');

    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('workspace_id = $1'), [WS, '/repo']);
  });
});
