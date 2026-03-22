import type { IssueBatch, HybridSearchResult } from '../types/index.js';
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
 */
export interface IStorage {
  /** Human-readable name (e.g. "PostgreSQL", "SQLite") */
  readonly name: string;

  /** Initialize storage (create tables, run migrations if needed) */
  initialize(): Promise<void>;

  /** Save a batch of issues + related data (upsert logic) */
  saveBatch(batch: IssueBatch): Promise<void>;

  /** Save a batch of commits + files + issue refs (upsert logic) */
  saveCommitBatch(batch: CommitBatch): Promise<void>;

  /** Get the latest `updated` timestamp for a project (for incremental pull) */
  getLastUpdated(projectKey: string): Promise<string | null>;

  /** Get the latest commit date for a repository (for incremental pull) */
  getLastCommitDate(repoPath: string): Promise<Date | null>;

  /** Save a batch of GitHub PRs + reviews + comments + files (upsert logic) */
  saveGitHubBatch(batch: GitHubBatch): Promise<void>;

  /** Save releases (upsert logic) */
  saveReleases(releases: Release[]): Promise<void>;

  /** Get the latest PR updated_at timestamp for a repo (for incremental pull) */
  getLastPrUpdated(repoFullName: string): Promise<Date | null>;

  /** Get issue keys that have no embedding yet (for batch embedding) */
  getUnembeddedIssueKeys(limit: number): Promise<string[]>;

  /** Save a computed embedding vector for an issue */
  saveEmbedding(issueKey: string, vector: number[]): Promise<void>;

  /** Semantic vector similarity search — returns issue keys ordered by similarity */
  semanticSearch(vector: number[], limit: number, threshold?: number): Promise<{ issueKey: string; similarity: number }[]>;

  /**
   * Hybrid search — combines full-text (tsvector) and vector similarity (pgvector) using Reciprocal Rank Fusion.
   * @param query - text query for full-text search
   * @param vector - embedding vector for similarity search (null = text-only mode)
   * @param limit - max results
   * @param threshold - minimum similarity score for vector results (default 0.5)
   */
  hybridSearch(query: string, vector: number[] | null, limit: number, threshold?: number): Promise<HybridSearchResult[]>;

  /** Execute a raw SQL query with parameterized values */
  query(sql: string, params: unknown[]): Promise<QueryResult>;

  /** Save external database schema metadata (upsert logic) */
  saveDbSchemaBatch(batch: DbSchemaBatch, sourceName: string): Promise<void>;

  /** Delete all schema metadata for a given external database source */
  deleteDbSchema(sourceName: string): Promise<void>;

  /** Close connection / cleanup */
  close(): Promise<void>;
}
