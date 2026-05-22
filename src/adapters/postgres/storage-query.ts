import type pg from 'pg';
import type { QueryResult } from '../../core/ports/storage.js';

/**
 * Tenant tables that MUST appear with a `workspace_id` predicate when
 * referenced from {@link PostgresQueryStorage.queryForWorkspace}. Used
 * by the runtime guard to refuse SQL that could leak data across
 * workspaces.
 */
const TENANT_TABLES = new Set([
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
]);

/**
 * Reject SQL that references a tenant table without a `workspace_id`
 * predicate.
 *
 * Best-effort defense in depth against cross-workspace leaks from MCP
 * tools that forward arbitrary SQL from the agent. NOT a security
 * boundary — the regex match can be bypassed with string literals,
 * comments, or quoted identifiers. The first line of defense is the
 * caller MUST include `WHERE workspace_id = $1` in their SQL; this
 * guard rejects accidental omissions.
 */
export function assertWorkspaceScoped(sql: string): void {
  const lowered = sql.toLowerCase();
  const touches = [...TENANT_TABLES].some((t) =>
    new RegExp(`\\b${t}\\b`).test(lowered),
  );
  if (!touches) {
    return;
  }
  if (!/\bworkspace_id\b/.test(lowered)) {
    throw new Error(
      'queryForWorkspace: SQL touches a tenant table without a workspace_id predicate. Use rawQuery() for admin paths.',
    );
  }
}

/**
 * Generic SQL runner with tenant-scoping guard. Used by MCP tools
 * that compose ad-hoc queries (e.g. `query_issues`, `db_query`,
 * `db_stats`). Orchestrated by `PostgresStorage`.
 */
export class PostgresQueryStorage {
  constructor(private readonly pool: pg.Pool) {}

  async queryForWorkspace(workspaceId: string, sql: string, params: unknown[]): Promise<QueryResult> {
    assertWorkspaceScoped(sql);
    const result = await this.pool.query(sql, [workspaceId, ...params]);
    return { rows: result.rows as Record<string, unknown>[] };
  }

  async rawQuery(sql: string, params: unknown[]): Promise<QueryResult> {
    const result = await this.pool.query(sql, params);
    return { rows: result.rows as Record<string, unknown>[] };
  }
}
