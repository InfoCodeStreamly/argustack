/**
 * Unit tests for postgres schema initialisation.
 *
 * Verifies that ensureSchema calls pool.query the correct number of times
 * and includes the expected DDL statements, without connecting to a real
 * database.  pg.Pool is replaced by a minimal mock that records every SQL
 * string passed to query().
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type pg from 'pg';

vi.mock('../../../../src/adapters/postgres/connection.js', () => ({
  createPool: vi.fn(),
}));

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let ensureSchema: typeof import('../../../../src/adapters/postgres/schema.js').ensureSchema;

interface MockPool {
  query: ReturnType<typeof vi.fn>;
}

let mockPool: MockPool;

const EXPECTED_TABLES = [
  'issues',
  'issue_comments',
  'issue_changelogs',
  'issue_worklogs',
  'issue_links',
  'commits',
  'commit_files',
  'commit_issue_refs',
  'pull_requests',
  'pr_reviews',
  'pr_comments',
  'pr_files',
  'pr_issue_refs',
  'releases',
  'db_tables',
  'db_columns',
  'db_foreign_keys',
  'db_indexes',
] as const;

const EXPECTED_MIGRATION_COLUMNS = [
  'original_estimate',
  'remaining_estimate',
  'time_spent',
  'assignee_id',
  'reporter_id',
] as const;

const EXPECTED_INDEX_NAMES = [
  'idx_issues_project',
  'idx_issues_status',
  'idx_issues_type',
  'idx_issues_assignee',
  'idx_issues_created',
  'idx_issues_updated',
  'idx_issues_search',
  'idx_issues_custom',
  'idx_issues_raw',
  'idx_issues_source',
  'idx_comments_key',
  'idx_changelogs_key',
  'idx_worklogs_key',
  'idx_links_source',
  'idx_links_target',
  'idx_commits_author',
  'idx_commits_date',
  'idx_commits_repo',
  'idx_commits_search',
  'idx_commit_files_hash',
  'idx_commit_files_path',
  'idx_commit_refs_issue',
  'idx_prs_repo',
  'idx_prs_state',
  'idx_prs_author',
  'idx_prs_merged',
  'idx_prs_updated',
  'idx_prs_merge_sha',
  'idx_prs_search',
  'idx_pr_reviews_pr',
  'idx_pr_comments_pr',
  'idx_pr_files_pr',
  'idx_pr_files_path',
  'idx_pr_refs_issue',
  'idx_releases_repo',
  'idx_releases_tag',
  'idx_releases_search',
  'idx_db_tables_source',
  'idx_db_columns_source',
  'idx_db_columns_table',
  'idx_db_fk_source',
  'idx_db_indexes_source',
  'idx_issues_locally_modified',
  'idx_graph_entities_name',
  'idx_graph_entities_type',
  'idx_graph_rel_source',
  'idx_graph_rel_target',
  'idx_graph_rel_type',
  'idx_graph_rel_origin',
  'idx_graph_obs_entity',
] as const;

beforeEach(async () => {
  vi.clearAllMocks();

  mockPool = {
    query: vi.fn().mockResolvedValue({ rows: [] }),
  };

  const schemaModule = await import('../../../../src/adapters/postgres/schema.js');
  ensureSchema = schemaModule.ensureSchema;
});

function allQueriedSql(): string[] {
  return (mockPool.query.mock.calls as [string][]).map(([sql]) => sql.trim());
}

// ─── extension ─────────────────────────────────────────────────────────────

describe('ensureSchema — CREATE EXTENSION', () => {
  it('creates the vector extension', async () => {
    await ensureSchema(mockPool as unknown as pg.Pool);

    const queries = allQueriedSql();
    expect(queries.some(q => q.includes('CREATE EXTENSION IF NOT EXISTS vector'))).toBe(true);
  });
});

// ─── tables ────────────────────────────────────────────────────────────────

describe('ensureSchema — CREATE TABLE', () => {
  it.each(EXPECTED_TABLES)('creates table: %s', async (tableName) => {
    await ensureSchema(mockPool as unknown as pg.Pool);

    const queries = allQueriedSql();
    const hasTable = queries.some(q =>
      q.includes('CREATE TABLE IF NOT EXISTS') && q.includes(tableName),
    );
    expect(hasTable).toBe(true);
  });

  it('creates exactly 21 tables', async () => {
    await ensureSchema(mockPool as unknown as pg.Pool);

    const queries = allQueriedSql();
    const tableCount = queries.filter(q => q.includes('CREATE TABLE IF NOT EXISTS')).length;
    expect(tableCount).toBe(21);
  });
});

// ─── migration columns ─────────────────────────────────────────────────────

describe('ensureSchema — ALTER TABLE migrations', () => {
  it.each(EXPECTED_MIGRATION_COLUMNS)('adds migration column: %s', async (column) => {
    await ensureSchema(mockPool as unknown as pg.Pool);

    const queries = allQueriedSql();
    const hasMigration = queries.some(q =>
      q.includes('ALTER TABLE') &&
      q.includes('ADD COLUMN IF NOT EXISTS') &&
      q.includes(column),
    );
    expect(hasMigration).toBe(true);
  });

  it('adds search_vector migration columns to issues, commits, pull_requests, and releases', async () => {
    await ensureSchema(mockPool as unknown as pg.Pool);

    const queries = allQueriedSql();
    const searchVectorMigrations = queries.filter(q =>
      q.includes('ALTER TABLE') &&
      q.includes('ADD COLUMN IF NOT EXISTS') &&
      q.includes('search_vector'),
    );
    expect(searchVectorMigrations.length).toBe(4);
  });

  it('issues exactly 13 ALTER TABLE statements', async () => {
    await ensureSchema(mockPool as unknown as pg.Pool);

    const queries = allQueriedSql();
    const alterCount = queries.filter(q => q.includes('ALTER TABLE')).length;
    expect(alterCount).toBe(13);
  });
});

// ─── indexes ───────────────────────────────────────────────────────────────

describe('ensureSchema — CREATE INDEX', () => {
  it.each(EXPECTED_INDEX_NAMES)('creates index: %s', async (indexName) => {
    await ensureSchema(mockPool as unknown as pg.Pool);

    const queries = allQueriedSql();
    const hasIndex = queries.some(q =>
      q.includes('CREATE INDEX IF NOT EXISTS') && q.includes(indexName),
    );
    expect(hasIndex).toBe(true);
  });

  it('creates exactly 50 indexes', async () => {
    await ensureSchema(mockPool as unknown as pg.Pool);

    const queries = allQueriedSql();
    const indexCount = queries.filter(q => q.includes('CREATE INDEX IF NOT EXISTS')).length;
    expect(indexCount).toBe(50);
  });
});

// ─── total call count ──────────────────────────────────────────────────────

describe('ensureSchema — total pool.query calls', () => {
  it('calls pool.query exactly 85 times (1 extension + 21 tables + 13 alters + 50 indexes)', async () => {
    await ensureSchema(mockPool as unknown as pg.Pool);

    expect(mockPool.query).toHaveBeenCalledTimes(85);
  });

  it('resolves without throwing when pool.query always succeeds', async () => {
    await expect(ensureSchema(mockPool as unknown as pg.Pool)).resolves.toBeUndefined();
  });
});
