/**
 * Fake IStorage — in-memory Map-based implementation.
 * Used in unit/integration tests instead of PostgreSQL.
 *
 * Methods return Promise.resolve() instead of using async keyword
 * to avoid require-await lint violations.
 */

import type { IStorage, QueryResult } from '../../../src/core/ports/storage.js';
import type { IssueBatch, Issue, PullRequest, Release, GitHubBatch, HybridSearchResult } from '../../../src/core/types/index.js';
import type { CommitBatch, Commit } from '../../../src/core/types/git.js';
import type { DbSchemaBatch } from '../../../src/core/types/database.js';

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

  query(sql: string, params: unknown[]): Promise<QueryResult> {
    // Support SELECT summary, description for EmbedUseCase
    if (sql.includes('summary') && sql.includes('description') && typeof params[0] === 'string') {
      const issue = this.issues.get(params[0]);
      if (issue) {
        return Promise.resolve({
          rows: [{ summary: issue.summary, description: issue.description }],
        });
      }
    }
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

  // ─── Embedding methods ──────────────────────────────────────────

  private readonly _embeddings = new Map<string, number[]>();

  getUnembeddedIssueKeys(limit: number): Promise<string[]> {
    const keys: string[] = [];
    for (const [key] of this.issues) {
      if (!this._embeddings.has(key)) {
        keys.push(key);
        if (keys.length >= limit) { break; }
      }
    }
    return Promise.resolve(keys);
  }

  saveEmbedding(issueKey: string, vector: number[]): Promise<void> {
    this._embeddings.set(issueKey, vector);
    return Promise.resolve();
  }

  semanticSearch(
    _vector: number[],
    limit: number,
    _threshold?: number
  ): Promise<{ issueKey: string; similarity: number }[]> {
    const results: { issueKey: string; similarity: number }[] = [];
    for (const [key] of this._embeddings) {
      results.push({ issueKey: key, similarity: 0.9 });
      if (results.length >= limit) { break; }
    }
    return Promise.resolve(results);
  }

  hybridSearch(
    _query: string,
    _vector: number[] | null,
    limit: number,
    _threshold?: number
  ): Promise<HybridSearchResult[]> {
    const results: HybridSearchResult[] = [];
    for (const [key] of this._embeddings) {
      results.push({ issueKey: key, score: 0.85, source: 'both' });
      if (results.length >= limit) { break; }
    }
    if (results.length === 0) {
      for (const batch of this.savedBatches) {
        for (const issue of batch.issues) {
          results.push({ issueKey: issue.key, score: 0.5, source: 'text' });
          if (results.length >= limit) { break; }
        }
        if (results.length >= limit) { break; }
      }
    }
    return Promise.resolve(results);
  }

  get embeddingCount(): number {
    return this._embeddings.size;
  }

  hasEmbedding(issueKey: string): boolean {
    return this._embeddings.has(issueKey);
  }

  // ─── DB schema methods ─────────────────────────────────────────

  readonly savedDbBatches: { batch: DbSchemaBatch; sourceName: string }[] = [];
  readonly deletedDbSources: string[] = [];

  saveDbSchemaBatch(batch: DbSchemaBatch, sourceName: string): Promise<void> {
    this.savedDbBatches.push({ batch, sourceName });
    return Promise.resolve();
  }

  deleteDbSchema(sourceName: string): Promise<void> {
    this.deletedDbSources.push(sourceName);
    return Promise.resolve();
  }

  // ─── Local issues (board sync) ─────────────────────────────────

  getLocalIssues(): Promise<Issue[]> {
    const locals: Issue[] = [];
    for (const issue of this.issues.values()) {
      if (issue.source === 'local') {
        locals.push(issue);
      }
    }
    return Promise.resolve(locals);
  }

  updateIssueSource(issueKey: string, source: string): Promise<void> {
    const issue = this.issues.get(issueKey);
    if (issue) {
      this.issues.set(issueKey, { ...issue, source: source as 'jira' | 'local' });
    }
    return Promise.resolve();
  }

  // ─── Update issue fields ──────────────────────────────────────

  private readonly _modifiedKeys = new Set<string>();

  updateIssueFields(issueKey: string, fields: Partial<Issue>): Promise<void> {
    const issue = this.issues.get(issueKey);
    if (!issue) {
      return Promise.reject(new Error(`Issue ${issueKey} not found in local database`));
    }
    this.issues.set(issueKey, { ...issue, ...fields });
    this._modifiedKeys.add(issueKey);
    return Promise.resolve();
  }

  getModifiedIssues(): Promise<Issue[]> {
    const modified: Issue[] = [];
    for (const key of this._modifiedKeys) {
      const issue = this.issues.get(key);
      if (issue) {
        modified.push(issue);
      }
    }
    return Promise.resolve(modified);
  }

  clearModifiedFlag(issueKey: string): Promise<void> {
    this._modifiedKeys.delete(issueKey);
    return Promise.resolve();
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
    this._embeddings.clear();
    this.savedDbBatches.length = 0;
    this.deletedDbSources.length = 0;
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
