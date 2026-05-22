/**
 * Unit tests for {@link PostgresPullRequestStorage} — PRs + releases.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type pg from 'pg';
import { PostgresPullRequestStorage } from '../../../../src/adapters/postgres/storage-prs.js';
import type { GitHubBatch, Release } from '../../../../src/core/types/github.js';
import { TEST_IDS, GITHUB_TEST_IDS } from '../../../fixtures/shared/test-constants.js';

interface MockClient {
  query: ReturnType<typeof vi.fn<(sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>>>;
  release: ReturnType<typeof vi.fn>;
}

const WS = 'ws-test';
const REPO = GITHUB_TEST_IDS.repoFullName;

function emptyBatch(): GitHubBatch {
  return { pullRequests: [], reviews: [], comments: [], files: [], issueRefs: [] };
}

function prBatch(): GitHubBatch {
  return {
    pullRequests: [{
      number: 42, repoFullName: REPO, title: 'fix', body: 'body', state: 'merged', author: 'alice',
      createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-02T00:00:00Z',
      mergedAt: '2025-01-02T00:00:00Z', closedAt: '2025-01-02T00:00:00Z',
      mergeCommitSha: 'a'.repeat(40), headRef: 'feat', baseRef: 'main',
      labels: [], reviewers: [], additions: 5, deletions: 1, changedFiles: 1, rawJson: {},
    }],
    reviews: [{ prNumber: 42, repoFullName: REPO, reviewId: 1, reviewer: 'bob', state: 'APPROVED', body: 'lgtm', submittedAt: '2025-01-02T00:00:00Z' }],
    comments: [{ prNumber: 42, repoFullName: REPO, commentId: 1, author: 'bob', body: 'nit', path: 'a.ts', line: 1, createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z' }],
    files: [{ prNumber: 42, repoFullName: REPO, filePath: 'a.ts', status: 'modified', additions: 5, deletions: 1 }],
    issueRefs: [{ prNumber: 42, repoFullName: REPO, issueKey: TEST_IDS.issueKey }],
  };
}

let client: MockClient;
let pool: { query: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn>; };
let storage: PostgresPullRequestStorage;

beforeEach(() => {
  client = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }), release: vi.fn() };
  pool = {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
    connect: vi.fn().mockResolvedValue(client),
  };
  storage = new PostgresPullRequestStorage(pool as unknown as pg.Pool);
});

describe('saveGitHubBatch', () => {
  it('upserts PRs and child rows inside a transaction', async () => {
    await storage.saveGitHubBatch(WS, prBatch());

    const sqls = client.query.mock.calls.map((c) => c[0]);
    expect(sqls[0]).toBe('BEGIN');
    expect(sqls).toContain('COMMIT');
    expect(sqls.some((s) => s.includes('INSERT INTO pull_requests'))).toBe(true);
    expect(sqls.some((s) => s.includes('INSERT INTO pr_reviews'))).toBe(true);
    expect(sqls.some((s) => s.includes('INSERT INTO pr_comments'))).toBe(true);
  });

  it('rolls back on insert failure', async () => {
    client.query.mockImplementation(async (sql: string) => {
      await Promise.resolve();
      if (sql.includes('INSERT INTO pull_requests')) {
        throw new Error('fk violation');
      }
      return { rows: [], rowCount: 1 };
    });

    await expect(storage.saveGitHubBatch(WS, prBatch())).rejects.toThrow('fk violation');
    expect(client.query.mock.calls.map((c) => c[0])).toContain('ROLLBACK');
  });

  it('skips child-table deletes when there are no PRs', async () => {
    await storage.saveGitHubBatch(WS, emptyBatch());

    const sqls = client.query.mock.calls.map((c) => c[0]);
    expect(sqls.some((s) => s.includes('DELETE FROM pr_reviews'))).toBe(false);
  });
});

describe('saveReleases', () => {
  it('upserts each release inside a transaction', async () => {
    const releases: Release[] = [{
      id: 1, repoFullName: REPO, tagName: 'v1.0.0', name: 'First', body: 'notes', author: 'alice',
      draft: false, prerelease: false, createdAt: '2025-01-01T00:00:00Z', publishedAt: '2025-01-01T00:00:00Z',
      rawJson: {},
    }];

    await storage.saveReleases(WS, releases);

    const sqls = client.query.mock.calls.map((c) => c[0]);
    expect(sqls).toContain('BEGIN');
    expect(sqls).toContain('COMMIT');
    expect(sqls.some((s) => s.includes('INSERT INTO releases'))).toBe(true);
  });

  it('commits an empty transaction when releases list is empty', async () => {
    await storage.saveReleases(WS, []);

    const sqls = client.query.mock.calls.map((c) => c[0]);
    expect(sqls).toEqual(['BEGIN', 'COMMIT']);
  });
});

describe('getLastPrUpdated', () => {
  it('returns null when no rows', async () => {
    pool.query.mockResolvedValue({ rows: [{ last_updated: null }] });

    expect(await storage.getLastPrUpdated(WS, REPO)).toBeNull();
  });

  it('returns MAX(updated_at) for the repo', async () => {
    const date = new Date('2025-03-01T00:00:00Z');
    pool.query.mockResolvedValue({ rows: [{ last_updated: date }] });

    expect(await storage.getLastPrUpdated(WS, REPO)).toBe(date);
  });
});
