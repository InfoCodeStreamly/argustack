import type { DbSchemaBatch, DbEngine } from '../types/database.js';
import type { QueryResult } from './storage.js';

/**
 * Port: Database Provider — reads schema and runs queries against an external database.
 *
 * Implementations: DbProvider (Knex.js, multi-dialect).
 * Core doesn't know about Knex or any specific driver.
 *
 * @throws Error if connection fails or query is rejected
 */
export interface IDbProvider {
  readonly name: string;
  readonly engine: DbEngine;

  /** Establish connection to the external database */
  connect(): Promise<void>;

  /**
   * Introspect database schema — tables, columns, foreign keys, indexes.
   * Yields batches for memory efficiency with large schemas.
   */
  introspect(): AsyncGenerator<DbSchemaBatch>;

  /**
   * Execute a read-only SQL query against the external database.
   * Only SELECT, EXPLAIN, SHOW are allowed.
   *
   * @throws Error if query is rejected by the SQL validator
   */
  query(sql: string): Promise<QueryResult>;

  /** Get total table count for progress reporting */
  getTableCount(): Promise<number>;

  /** Close connection */
  disconnect(): Promise<void>;
}
