/**
 * Fake IStorage — in-memory Map-based implementation.
 * Used in unit/integration tests instead of PostgreSQL.
 */

import type { IStorage, QueryResult } from '../../../src/core/ports/storage.js';
import type { IssueBatch, Issue } from '../../../src/core/types/index.js';

export class FakeStorage implements IStorage {
  readonly name = 'FakeStorage';

  /** All stored issues, keyed by issue_key */
  readonly issues = new Map<string, Issue>();

  /** Batches received (for verifying call sequence) */
  readonly savedBatches: IssueBatch[] = [];

  /** Last updated timestamps per project */
  private readonly _lastUpdated = new Map<string, string>();

  /** Track if initialize() was called */
  initialized = false;

  /** Track if close() was called */
  closed = false;

  // eslint-disable-next-line @typescript-eslint/require-await -- fake: sync impl of async interface
  async initialize(): Promise<void> {
    this.initialized = true;
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- fake: sync impl of async interface
  async saveBatch(batch: IssueBatch): Promise<void> {
    this.savedBatches.push(batch);
    for (const issue of batch.issues) {
      this.issues.set(issue.key, issue);
      if (issue.updated) {
        const current = this._lastUpdated.get(issue.projectKey);
        if (!current || issue.updated > current) {
          this._lastUpdated.set(issue.projectKey, issue.updated);
        }
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- fake: sync impl of async interface
  async getLastUpdated(projectKey: string): Promise<string | null> {
    return this._lastUpdated.get(projectKey) ?? null;
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- fake: sync impl of async interface
  async query(_sql: string, _params: unknown[]): Promise<QueryResult> {
    return { rows: [] };
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- fake: sync impl of async interface
  async close(): Promise<void> {
    this.closed = true;
  }

  // ─── Test helpers ─────────────────────────────────────────────

  seed(issues: Issue[]): void {
    for (const issue of issues) {
      this.issues.set(issue.key, issue);
    }
  }

  seedLastUpdated(projectKey: string, timestamp: string): void {
    this._lastUpdated.set(projectKey, timestamp);
  }

  clear(): void {
    this.issues.clear();
    this.savedBatches.length = 0;
    this._lastUpdated.clear();
    this.initialized = false;
    this.closed = false;
  }

  get count(): number {
    return this.issues.size;
  }

  get batchCount(): number {
    return this.savedBatches.length;
  }
}
