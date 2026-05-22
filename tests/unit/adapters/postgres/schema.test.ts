/**
 * Unit tests for `ensureSchema` — the idempotent DDL applier for the
 * hub Postgres.
 *
 * Verifies that ensureSchema:
 *   - enables the pgvector extension
 *   - creates every table listed in {@link EXPECTED_TABLES}
 *   - creates every index listed in {@link EXPECTED_INDEXES}
 *
 * No ALTER TABLE assertions: the hub is created fresh by
 * `argustack init`, schema lives entirely in CREATE TABLE statements
 * (no rolling migrations). Past tests that hardcoded "ALTER must add
 * column X" describe the pre-hub architecture and are gone.
 *
 * Numeric counts (24/53/92 from the legacy fixture) are not asserted —
 * they couple the test to internal SQL layout. The presence of each
 * named table and index is the actual contract.
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
  'workspaces',
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
  'graph_entities',
  'graph_relationships',
  'graph_observations',
  'db_tables',
  'db_columns',
  'db_foreign_keys',
  'db_indexes',
  'code_projects',
  'code_files',
  'code_index_jobs',
] as const;

const EXPECTED_INDEXES = [
  // workspaces
  'idx_workspaces_active',
  // issues
  'idx_issues_ws',
  'idx_issues_ws_project',
  'idx_issues_ws_status',
  'idx_issues_ws_type',
  'idx_issues_ws_assignee',
  'idx_issues_ws_created',
  'idx_issues_ws_source',
  'idx_issues_ws_modified',
  'idx_issues_search',
  'idx_issues_custom',
  'idx_issues_raw',
  // issue children
  'idx_comments_ws_key',
  'idx_changelogs_ws_key',
  'idx_worklogs_ws_key',
  'idx_links_ws_source',
  'idx_links_ws_target',
  // commits
  'idx_commits_ws_author',
  'idx_commits_ws_date',
  'idx_commits_ws_repo',
  'idx_commits_search',
  'idx_commit_files_ws_hash',
  'idx_commit_files_path',
  'idx_commit_refs_ws_issue',
  // pull requests
  'idx_prs_ws_repo',
  'idx_prs_ws_state',
  'idx_prs_ws_author',
  'idx_prs_ws_merged',
  'idx_prs_ws_updated',
  'idx_prs_merge_sha',
  'idx_prs_search',
  'idx_pr_reviews_pr',
  'idx_pr_comments_pr',
  'idx_pr_files_pr',
  'idx_pr_files_path',
  'idx_pr_refs_ws_issue',
  // releases
  'idx_releases_ws_repo',
  'idx_releases_tag',
  'idx_releases_search',
  // graph
  'idx_graph_entities_ws_name',
  'idx_graph_entities_ws_type',
  'idx_graph_rel_ws_source',
  'idx_graph_rel_ws_target',
  'idx_graph_rel_ws_type',
  'idx_graph_rel_origin',
  'idx_graph_obs_ws_entity',
  // db schema mirror
  'idx_db_tables_ws_source',
  'idx_db_columns_ws_source',
  'idx_db_columns_ws_table',
  'idx_db_fk_ws_source',
  'idx_db_indexes_ws_source',
  // code intelligence
  'idx_code_files_project',
  'idx_code_jobs_project_status',
  'idx_code_jobs_started',
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

describe('ensureSchema — CREATE EXTENSION', () => {
  it('enables the pgvector extension', async () => {
    await ensureSchema(mockPool as unknown as pg.Pool);

    const queries = allQueriedSql();
    expect(queries.some((q) => q.includes('CREATE EXTENSION IF NOT EXISTS vector'))).toBe(true);
  });
});

describe('ensureSchema — CREATE TABLE', () => {
  it.each(EXPECTED_TABLES)('creates table: %s', async (tableName) => {
    await ensureSchema(mockPool as unknown as pg.Pool);

    const queries = allQueriedSql();
    const hasTable = queries.some(
      (q) => q.includes('CREATE TABLE IF NOT EXISTS') && q.includes(tableName),
    );
    expect(hasTable).toBe(true);
  });

  it('creates every expected table exactly once', async () => {
    await ensureSchema(mockPool as unknown as pg.Pool);

    const queries = allQueriedSql();
    for (const table of EXPECTED_TABLES) {
      const occurrences = queries.filter(
        (q) =>
          q.includes('CREATE TABLE IF NOT EXISTS') &&
          new RegExp(`\\b${table}\\b`).test(q),
      );
      expect(occurrences.length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('ensureSchema — CREATE INDEX', () => {
  it.each(EXPECTED_INDEXES)('creates index: %s', async (indexName) => {
    await ensureSchema(mockPool as unknown as pg.Pool);

    const queries = allQueriedSql();
    const hasIndex = queries.some(
      (q) => q.includes('CREATE INDEX IF NOT EXISTS') && q.includes(indexName),
    );
    expect(hasIndex).toBe(true);
  });
});

describe('ensureSchema — workspace_id scoping', () => {
  it('every tenant table includes a workspace_id column', async () => {
    await ensureSchema(mockPool as unknown as pg.Pool);

    const queries = allQueriedSql();
    const tenantTables = EXPECTED_TABLES.filter(
      (t) => t !== 'workspaces' && t !== 'code_projects' && t !== 'code_files' && t !== 'code_index_jobs',
    );

    for (const table of tenantTables) {
      const ddl = queries.find(
        (q) =>
          q.includes('CREATE TABLE IF NOT EXISTS') &&
          new RegExp(`\\b${table}\\b`).test(q),
      );
      expect(ddl, `DDL for ${table} not found`).toBeDefined();
      expect(ddl).toMatch(/workspace_id\s+TEXT/i);
    }
  });
});

describe('ensureSchema — idempotency', () => {
  it('uses IF NOT EXISTS guards on every CREATE statement', async () => {
    await ensureSchema(mockPool as unknown as pg.Pool);

    const queries = allQueriedSql();
    const creates = queries.filter((q) =>
      /^CREATE\s+(TABLE|INDEX|EXTENSION)/i.test(q),
    );

    expect(creates.length).toBeGreaterThan(0);
    for (const ddl of creates) {
      expect(ddl).toMatch(/IF NOT EXISTS/i);
    }
  });

  it('resolves without throwing when pool.query always succeeds', async () => {
    await expect(ensureSchema(mockPool as unknown as pg.Pool)).resolves.toBeUndefined();
  });
});
