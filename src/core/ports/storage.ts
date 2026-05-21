import type {
  Issue,
  IssueBatch,
  HybridSearchResult,
  GraphEntity,
  GraphRelationship,
  GraphObservation,
  GraphQueryResult,
  GraphStats,
} from '../types/index.js';
import type { CommitBatch } from '../types/git.js';
import type { GitHubBatch, Release } from '../types/github.js';
import type { DbSchemaBatch } from '../types/database.js';

/** Generic query result — database-agnostic */
export interface QueryResult {
  rows: Record<string, unknown>[];
}

/**
 * Port: Storage — where we save data TO.
 *
 * Implementations: PostgresStorage, (future) SQLiteStorage, etc.
 * Core doesn't know about PostgreSQL or any specific database.
 *
 * Tenant model: every data-bearing method takes `workspaceId` as its
 * first parameter. The adapter must scope all reads and writes to
 * that tenant — there is no implicit "current workspace" inside the
 * storage. Callers (use cases) own workspace resolution.
 *
 * Admin-only methods (`rawQuery`) bypass workspace scoping and exist
 * for `argustack workspace info` / migration tooling — never call
 * them from a tenant-scoped use case.
 */
export interface IStorage {
  /** Human-readable name (e.g. "PostgreSQL", "SQLite") */
  readonly name: string;

  /** Initialize storage (create tables, run migrations if needed) */
  initialize(): Promise<void>;

  /** Save a batch of issues + related data (upsert logic) */
  saveBatch(workspaceId: string, batch: IssueBatch): Promise<void>;

  /** Save a batch of commits + files + issue refs (upsert logic) */
  saveCommitBatch(workspaceId: string, batch: CommitBatch): Promise<void>;

  /** Get the latest `updated` timestamp for a project (for incremental pull) */
  getLastUpdated(workspaceId: string, projectKey: string): Promise<string | null>;

  /** Get the latest commit date for a repository (for incremental pull) */
  getLastCommitDate(workspaceId: string, repoPath: string): Promise<Date | null>;

  /** Save a batch of GitHub PRs + reviews + comments + files (upsert logic) */
  saveGitHubBatch(workspaceId: string, batch: GitHubBatch): Promise<void>;

  /** Save releases (upsert logic) */
  saveReleases(workspaceId: string, releases: Release[]): Promise<void>;

  /** Get the latest PR updated_at timestamp for a repo (for incremental pull) */
  getLastPrUpdated(workspaceId: string, repoFullName: string): Promise<Date | null>;

  /** Get issue keys that have no embedding yet (for batch embedding) */
  getUnembeddedIssueKeys(workspaceId: string, limit: number): Promise<string[]>;

  /** Save a computed embedding vector for an issue */
  saveEmbedding(workspaceId: string, issueKey: string, vector: number[]): Promise<void>;

  /** Semantic vector similarity search — returns issue keys ordered by similarity */
  semanticSearch(
    workspaceId: string,
    vector: number[],
    limit: number,
    threshold?: number,
  ): Promise<{ issueKey: string; similarity: number }[]>;

  /**
   * Hybrid search — combines full-text (tsvector) and vector similarity (pgvector) using Reciprocal Rank Fusion.
   * @param workspaceId - tenant scope
   * @param query - text query for full-text search
   * @param vector - embedding vector for similarity search (null = text-only mode)
   * @param limit - max results
   * @param threshold - minimum similarity score for vector results (default 0.5)
   */
  hybridSearch(
    workspaceId: string,
    query: string,
    vector: number[] | null,
    limit: number,
    threshold?: number,
  ): Promise<HybridSearchResult[]>;

  /**
   * Execute a tenant-scoped SQL query.
   *
   * Contract:
   *   - `workspaceId` is bound as `params[0]` by the adapter — the caller
   *     MUST reference it in the SQL as `$1` (and shift other placeholders).
   *   - The SQL MUST include a `workspace_id = $1` predicate against every
   *     tenant-scoped table it touches. The adapter rejects queries that
   *     reference a known tenant table without a `workspace_id` predicate
   *     (defense in depth against cross-workspace data leaks from MCP
   *     `db_query`-style tools).
   *   - Returns the same shape as {@link rawQuery} but guarantees tenant
   *     isolation by construction.
   *
   * @throws StorageError when the SQL is rejected by the workspace guard.
   */
  queryForWorkspace(workspaceId: string, sql: string, params: unknown[]): Promise<QueryResult>;

  /**
   * Admin-only: execute SQL without workspace scoping.
   *
   * Reserved for migration code (`argustack migrate-to-hub`),
   * `argustack workspace info`, and the `db_stats` MCP tool.
   * NEVER call from a tenant-scoped use case — there is no isolation.
   */
  rawQuery(sql: string, params: unknown[]): Promise<QueryResult>;

  /** Save external database schema metadata (upsert logic) */
  saveDbSchemaBatch(workspaceId: string, batch: DbSchemaBatch, sourceName: string): Promise<void>;

  /** Delete all schema metadata for a given external database source */
  deleteDbSchema(workspaceId: string, sourceName: string): Promise<void>;

  /** Get all issues with source = 'local' (created on board, not yet pushed to Jira) */
  getLocalIssues(workspaceId: string): Promise<Issue[]>;

  /** Update the source field for an issue (e.g., 'local' → 'jira' after push) */
  updateIssueSource(workspaceId: string, issueKey: string, source: string): Promise<void>;

  /** Update specific fields of an issue in local DB. Marks as locally_modified. */
  updateIssueFields(workspaceId: string, issueKey: string, fields: Partial<Issue>): Promise<void>;

  /** Get all issues that were modified locally (locally_modified = true). Returns issues with modifiedFields indicating which fields changed. */
  getModifiedIssues(workspaceId: string): Promise<(Issue & { modifiedFields: string[] })[]>;

  /** Clear the locally_modified flag after successful push to Jira */
  clearModifiedFlag(workspaceId: string, issueKey: string): Promise<void>;

  /** Save graph entities (UPSERT by workspace_id+name+type) */
  saveGraphEntities(workspaceId: string, entities: GraphEntity[]): Promise<void>;

  /** Save graph relationships (UPSERT by workspace_id+source_id+target_id+type) */
  saveGraphRelationships(workspaceId: string, rels: GraphRelationship[]): Promise<void>;

  /** Add an observation to an entity (append-only) */
  saveGraphObservation(
    workspaceId: string,
    entityId: number,
    content: string,
    author: string,
  ): Promise<void>;

  /** Get all observations for an entity */
  getObservations(workspaceId: string, entityId: number): Promise<GraphObservation[]>;

  /** Traverse graph from entity name, N levels deep */
  queryGraph(workspaceId: string, entityName: string, depth: number): Promise<GraphQueryResult>;

  /** Get graph statistics */
  getGraphStats(workspaceId: string): Promise<GraphStats>;

  /** Clear structural graph data (preserves claude-sourced) */
  clearGraph(workspaceId: string): Promise<void>;

  /** Close connection / cleanup */
  close(): Promise<void>;
}
