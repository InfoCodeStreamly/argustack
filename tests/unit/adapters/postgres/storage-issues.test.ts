/**
 * Unit tests for {@link PostgresIssueStorage}.
 *
 * The module owns SQL for the issues aggregate. Tests mock `pg.Pool`
 * and inspect the SQL/params each method emits — no real database.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type pg from 'pg';
import { PostgresIssueStorage } from '../../../../src/adapters/postgres/storage-issues.js';
import { createIssue, createBatch, createEmptyBatch, TEST_IDS } from '../../../fixtures/shared/test-constants.js';

interface MockClient {
  query: ReturnType<typeof vi.fn<(sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>>>;
  release: ReturnType<typeof vi.fn>;
}

interface MockPool {
  query: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
}

const WS = 'ws-test';

function makeClient(): MockClient {
  return {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
    release: vi.fn(),
  };
}

function makePool(client: MockClient): MockPool {
  return {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
    connect: vi.fn().mockResolvedValue(client),
  };
}

let client: MockClient;
let pool: MockPool;
let storage: PostgresIssueStorage;

beforeEach(() => {
  client = makeClient();
  pool = makePool(client);
  storage = new PostgresIssueStorage(pool as unknown as pg.Pool);
});

describe('PostgresIssueStorage.saveBatch', () => {
  it('opens a transaction, upserts issues, and commits', async () => {
    const batch = createBatch({ issues: [createIssue({ key: TEST_IDS.issueKey })] });

    await storage.saveBatch(WS, batch);

    const sqls = client.query.mock.calls.map((c) => c[0]);
    expect(sqls[0]).toBe('BEGIN');
    expect(sqls).toContain('COMMIT');
    expect(sqls.some((s) => s.includes('INSERT INTO issues'))).toBe(true);
    expect(client.release).toHaveBeenCalled();
  });

  it('rolls back the transaction when an insert throws', async () => {
    client.query.mockImplementation(async (sql: string) => {
      await Promise.resolve();
      if (sql.includes('INSERT INTO issues')) {
        throw new Error('duplicate key');
      }
      return { rows: [], rowCount: 1 };
    });

    await expect(storage.saveBatch(WS, createBatch({ issues: [createIssue()] }))).rejects.toThrow('duplicate key');

    const sqls = client.query.mock.calls.map((c) => c[0]);
    expect(sqls).toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });

  it('deletes children before re-inserting them to avoid duplicates', async () => {
    const issue = createIssue({ key: TEST_IDS.issueKey });
    const batch = createBatch({ issues: [issue], comments: [] });
    batch.comments.push({
      issueKey: issue.key, commentId: 'c1', author: 'alice', body: 'hi', created: null, updated: null,
    });

    await storage.saveBatch(WS, batch);

    const sqls = client.query.mock.calls.map((c) => c[0]);
    const deleteIdx = sqls.findIndex((s) => s.includes('DELETE FROM issue_comments'));
    const insertCommentIdx = sqls.findIndex((s) => s.includes('INSERT INTO issue_comments'));
    expect(deleteIdx).toBeGreaterThanOrEqual(0);
    expect(insertCommentIdx).toBeGreaterThan(deleteIdx);
  });

  it('skips child-table deletes when the batch has no issues', async () => {
    await storage.saveBatch(WS, createEmptyBatch());

    const sqls = client.query.mock.calls.map((c) => c[0]);
    expect(sqls.some((s) => s.includes('DELETE FROM issue_comments'))).toBe(false);
  });
});

describe('PostgresIssueStorage.getLastUpdated', () => {
  it('returns null when no issues exist for the project', async () => {
    pool.query.mockResolvedValue({ rows: [{ last_updated: null }] });

    const result = await storage.getLastUpdated(WS, 'PROJ');

    expect(result).toBeNull();
  });

  it('returns the max updated timestamp normalised to ISO', async () => {
    pool.query.mockResolvedValue({ rows: [{ last_updated: '2025-03-01T10:00:00Z' }] });

    const result = await storage.getLastUpdated(WS, 'PROJ');

    expect(result).toBe(new Date('2025-03-01T10:00:00Z').toISOString());
  });

  it('binds workspace_id and project_key as parameters', async () => {
    pool.query.mockResolvedValue({ rows: [] });

    await storage.getLastUpdated(WS, 'PROJ');

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('workspace_id = $1'),
      [WS, 'PROJ'],
    );
  });
});

describe('PostgresIssueStorage.updateIssueFields', () => {
  it('throws when the issue does not exist (no rows updated)', async () => {
    pool.query.mockResolvedValue({ rows: [], rowCount: 0 });

    await expect(
      storage.updateIssueFields(WS, TEST_IDS.issueKey, { summary: 'new' }),
    ).rejects.toThrow(/not found/);
  });

  it('no-ops when no recognised field is supplied', async () => {
    await storage.updateIssueFields(WS, TEST_IDS.issueKey, {});

    expect(pool.query).not.toHaveBeenCalled();
  });

  it('sets locally_modified=true and writes modified_fields list', async () => {
    pool.query.mockResolvedValue({ rows: [], rowCount: 1 });

    await storage.updateIssueFields(WS, TEST_IDS.issueKey, { summary: 'new', status: 'Done' });

    const [sql, params] = pool.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('locally_modified = true');
    expect(sql).toContain('modified_at = NOW()');
    expect(sql).toContain('modified_fields =');
    expect(params[0]).toBe(WS);
    expect(params[1]).toBe(TEST_IDS.issueKey);
    expect(params[params.length - 1]).toEqual(['summary', 'status']);
  });
});

describe('PostgresIssueStorage.getLocalIssues + getModifiedIssues', () => {
  it('filters local issues by source=\'local\'', async () => {
    pool.query.mockResolvedValue({ rows: [] });

    await storage.getLocalIssues(WS);

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("source = 'local'"),
      [WS],
    );
  });

  it('returns issues with modifiedFields array from modified_fields column', async () => {
    pool.query.mockResolvedValue({
      rows: [{
        issue_key: TEST_IDS.issueKey, issue_id: '1', project_key: 'PROJ', summary: 's',
        modified_fields: ['summary'],
      }],
    });

    const result = await storage.getModifiedIssues(WS);

    expect(result).toHaveLength(1);
    expect(result[0]?.modifiedFields).toEqual(['summary']);
  });
});

describe('PostgresIssueStorage.clearModifiedFlag + updateIssueSource', () => {
  it('clears the locally_modified flag and modified_at timestamp', async () => {
    await storage.clearModifiedFlag(WS, TEST_IDS.issueKey);

    const [sql, params] = pool.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('locally_modified = false');
    expect(sql).toContain('modified_at = NULL');
    expect(params).toEqual([WS, TEST_IDS.issueKey]);
  });

  it('updates source column for local→jira transition after push', async () => {
    await storage.updateIssueSource(WS, TEST_IDS.issueKey, 'jira');

    const [, params] = pool.query.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([WS, TEST_IDS.issueKey, 'jira']);
  });
});
