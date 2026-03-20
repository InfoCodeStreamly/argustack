/**
 * Fake IStorage — in-memory Map-based implementation.
 * Used in unit/integration tests instead of PostgreSQL.
 *
 * Methods return Promise.resolve() instead of using async keyword
 * to avoid require-await lint violations.
 */

import type { IStorage, QueryResult } from '../../../src/core/ports/storage.js';
import type { IssueBatch, Issue, PullRequest, Release, GitHubBatch } from '../../../src/core/types/index.js';
import type { CommitBatch, Commit } from '../../../src/core/types/git.js';

export class FakeStorage implements IStorage {
  readonly name = 'FakeStorage';

  readonly issues = new Map<string, Issue>();
  readonly savedBatches: IssueBatch[] = [];
  private readonly _lastUpdated = new Map<string, string>();

  initialized = false;
  closed = false;

  initialize(): Promise<void> {
    this.initialized = true;
    return Promise.resolve();
  }

  saveBatch(batch: IssueBatch): Promise<void> {
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
    return Promise.resolve();
  }

  getLastUpdated(projectKey: string): Promise<string | null> {
    return Promise.resolve(this._lastUpdated.get(projectKey) ?? null);
  }

  query(_sql: string, _params: unknown[]): Promise<QueryResult> {
    return Promise.resolve({ rows: [] });
  }

  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }

  // ─── Git methods ────────────────────────────────────────────

  readonly commits = new Map<string, Commit>();
  readonly savedCommitBatches: CommitBatch[] = [];
  private readonly _lastCommitDate = new Map<string, Date>();

  saveCommitBatch(batch: CommitBatch): Promise<void> {
    this.savedCommitBatches.push(batch);
    for (const commit of batch.commits) {
      this.commits.set(commit.hash, commit);
      const date = new Date(commit.committedAt);
      const current = this._lastCommitDate.get(commit.repoPath);
      if (!current || date > current) {
        this._lastCommitDate.set(commit.repoPath, date);
      }
    }
    return Promise.resolve();
  }

  getLastCommitDate(repoPath: string): Promise<Date | null> {
    return Promise.resolve(this._lastCommitDate.get(repoPath) ?? null);
  }

  // ─── GitHub methods ─────────────────────────────────────────

  readonly pullRequests = new Map<number, PullRequest>();
  readonly releases = new Map<number, Release>();
  readonly savedGitHubBatches: GitHubBatch[] = [];
  readonly savedReleases: Release[][] = [];
  private readonly _lastPrUpdated = new Map<string, Date>();

  saveGitHubBatch(batch: GitHubBatch): Promise<void> {
    this.savedGitHubBatches.push(batch);
    for (const pr of batch.pullRequests) {
      this.pullRequests.set(pr.number, pr);
      const date = new Date(pr.updatedAt);
      const current = this._lastPrUpdated.get(pr.repoFullName);
      if (!current || date > current) {
        this._lastPrUpdated.set(pr.repoFullName, date);
      }
    }
    return Promise.resolve();
  }

  saveReleases(releases: Release[]): Promise<void> {
    this.savedReleases.push(releases);
    for (const rel of releases) {
      this.releases.set(rel.id, rel);
    }
    return Promise.resolve();
  }

  getLastPrUpdated(repoFullName: string): Promise<Date | null> {
    return Promise.resolve(this._lastPrUpdated.get(repoFullName) ?? null);
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
    this.commits.clear();
    this.savedCommitBatches.length = 0;
    this._lastCommitDate.clear();
    this.pullRequests.clear();
    this.releases.clear();
    this.savedGitHubBatches.length = 0;
    this.savedReleases.length = 0;
    this._lastPrUpdated.clear();
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
