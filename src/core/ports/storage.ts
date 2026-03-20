import type { IssueBatch } from '../types/index.js';
import type { CommitBatch } from '../types/git.js';

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

  /** Execute a raw SQL query with parameterized values */
  query(sql: string, params: unknown[]): Promise<QueryResult>;

  /** Close connection / cleanup */
  close(): Promise<void>;
}
