/**
 * Fake IStorage — in-memory Map-based implementation keyed by workspaceId.
 *
 * Every method takes workspaceId first to match the hub IStorage contract.
 */

import type { IStorage, QueryResult } from '../../../src/core/ports/storage.js';
import type {
  IssueBatch, Issue, PullRequest, Release, GitHubBatch,
  HybridSearchResult, GraphEntity, GraphRelationship, GraphObservation,
  GraphQueryResult, GraphStats,
} from '../../../src/core/types/index.js';
import type { CommitBatch, Commit } from '../../../src/core/types/git.js';
import type { DbSchemaBatch } from '../../../src/core/types/database.js';

function key(workspaceId: string, id: string | number): string {
  return `${workspaceId}::${String(id)}`;
}

export class FakeStorage implements IStorage {
  readonly name = 'FakeStorage';

  readonly issues = new Map<string, Issue>();
  readonly savedBatches: { workspaceId: string; batch: IssueBatch }[] = [];
  private readonly _lastUpdated = new Map<string, string>();
  private readonly _workspaceIssues = new Map<string, string>();

  initialized = false;
  closed = false;

  initialize(): Promise<void> {
    this.initialized = true;
    return Promise.resolve();
  }

  saveBatch(workspaceId: string, batch: IssueBatch): Promise<void> {
    this.savedBatches.push({ workspaceId, batch });
    for (const issue of batch.issues) {
      const k = key(workspaceId, issue.key);
      this.issues.set(k, issue);
      this._workspaceIssues.set(k, workspaceId);
      if (issue.updated) {
        const lk = key(workspaceId, issue.projectKey);
        const current = this._lastUpdated.get(lk);
        if (!current || issue.updated > current) {
          this._lastUpdated.set(lk, issue.updated);
        }
      }
    }
    return Promise.resolve();
  }

  getLastUpdated(workspaceId: string, projectKey: string): Promise<string | null> {
    return Promise.resolve(this._lastUpdated.get(key(workspaceId, projectKey)) ?? null);
  }

  queryForWorkspace(_workspaceId: string, sql: string, params: unknown[]): Promise<QueryResult> {
    if (sql.includes('summary') && sql.includes('description') && typeof params[0] === 'string') {
      const issue = this.issues.get(key(_workspaceId, params[0]));
      if (issue) {
        return Promise.resolve({
          rows: [{ summary: issue.summary, description: issue.description }],
        });
      }
    }
    return Promise.resolve({ rows: [] });
  }

  rawQuery(_sql: string, _params: unknown[]): Promise<QueryResult> {
    return Promise.resolve({ rows: [] });
  }

  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }

  // ─── Git ────────────────────────────────────────────

  readonly commits = new Map<string, Commit>();
  readonly savedCommitBatches: { workspaceId: string; batch: CommitBatch }[] = [];
  private readonly _lastCommitDate = new Map<string, Date>();

  saveCommitBatch(workspaceId: string, batch: CommitBatch): Promise<void> {
    this.savedCommitBatches.push({ workspaceId, batch });
    for (const commit of batch.commits) {
      this.commits.set(key(workspaceId, commit.hash), commit);
      const date = new Date(commit.committedAt);
      const lk = key(workspaceId, commit.repoPath);
      const current = this._lastCommitDate.get(lk);
      if (!current || date > current) {
        this._lastCommitDate.set(lk, date);
      }
    }
    return Promise.resolve();
  }

  getLastCommitDate(workspaceId: string, repoPath: string): Promise<Date | null> {
    return Promise.resolve(this._lastCommitDate.get(key(workspaceId, repoPath)) ?? null);
  }

  // ─── GitHub ─────────────────────────────────────────

  readonly pullRequests = new Map<string, PullRequest>();
  readonly releases = new Map<string, Release>();
  readonly savedGitHubBatches: { workspaceId: string; batch: GitHubBatch }[] = [];
  readonly savedReleases: { workspaceId: string; releases: Release[] }[] = [];
  private readonly _lastPrUpdated = new Map<string, Date>();

  saveGitHubBatch(workspaceId: string, batch: GitHubBatch): Promise<void> {
    this.savedGitHubBatches.push({ workspaceId, batch });
    for (const pr of batch.pullRequests) {
      this.pullRequests.set(key(workspaceId, pr.number), pr);
      const date = new Date(pr.updatedAt);
      const lk = key(workspaceId, pr.repoFullName);
      const current = this._lastPrUpdated.get(lk);
      if (!current || date > current) {
        this._lastPrUpdated.set(lk, date);
      }
    }
    return Promise.resolve();
  }

  saveReleases(workspaceId: string, releases: Release[]): Promise<void> {
    this.savedReleases.push({ workspaceId, releases });
    for (const rel of releases) {
      this.releases.set(key(workspaceId, rel.id), rel);
    }
    return Promise.resolve();
  }

  getLastPrUpdated(workspaceId: string, repoFullName: string): Promise<Date | null> {
    return Promise.resolve(this._lastPrUpdated.get(key(workspaceId, repoFullName)) ?? null);
  }

  // ─── Embeddings ──────────────────────────────────────────

  private readonly _embeddings = new Map<string, number[]>();

  getUnembeddedIssueKeys(workspaceId: string, limit: number): Promise<string[]> {
    const keys: string[] = [];
    for (const [k, ws] of this._workspaceIssues) {
      if (ws !== workspaceId) { continue; }
      if (!this._embeddings.has(k)) {
        const issue = this.issues.get(k);
        if (issue) {
          keys.push(issue.key);
          if (keys.length >= limit) { break; }
        }
      }
    }
    return Promise.resolve(keys);
  }

  saveEmbedding(workspaceId: string, issueKey: string, vector: number[]): Promise<void> {
    this._embeddings.set(key(workspaceId, issueKey), vector);
    return Promise.resolve();
  }

  semanticSearch(
    workspaceId: string,
    _vector: number[],
    limit: number,
    _threshold?: number,
  ): Promise<{ issueKey: string; similarity: number }[]> {
    const results: { issueKey: string; similarity: number }[] = [];
    for (const [k] of this._embeddings) {
      if (k.startsWith(`${workspaceId}::`)) {
        results.push({ issueKey: k.slice(workspaceId.length + 2), similarity: 0.9 });
        if (results.length >= limit) { break; }
      }
    }
    return Promise.resolve(results);
  }

  hybridSearch(
    workspaceId: string,
    _query: string,
    _vector: number[] | null,
    limit: number,
    _threshold?: number,
  ): Promise<HybridSearchResult[]> {
    const results: HybridSearchResult[] = [];
    for (const [k] of this._embeddings) {
      if (k.startsWith(`${workspaceId}::`)) {
        results.push({ issueKey: k.slice(workspaceId.length + 2), score: 0.85, source: 'both' });
        if (results.length >= limit) { break; }
      }
    }
    if (results.length === 0) {
      for (const entry of this.savedBatches) {
        if (entry.workspaceId !== workspaceId) { continue; }
        for (const issue of entry.batch.issues) {
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

  hasEmbedding(workspaceId: string, issueKey: string): boolean {
    return this._embeddings.has(key(workspaceId, issueKey));
  }

  // ─── DB schema ─────────────────────────────────────────

  readonly savedDbBatches: { workspaceId: string; batch: DbSchemaBatch; sourceName: string }[] = [];
  readonly deletedDbSources: { workspaceId: string; sourceName: string }[] = [];

  saveDbSchemaBatch(workspaceId: string, batch: DbSchemaBatch, sourceName: string): Promise<void> {
    this.savedDbBatches.push({ workspaceId, batch, sourceName });
    return Promise.resolve();
  }

  deleteDbSchema(workspaceId: string, sourceName: string): Promise<void> {
    this.deletedDbSources.push({ workspaceId, sourceName });
    return Promise.resolve();
  }

  // ─── Local issues ─────────────────────────────────

  getLocalIssues(workspaceId: string): Promise<Issue[]> {
    const locals: Issue[] = [];
    for (const [k, ws] of this._workspaceIssues) {
      if (ws !== workspaceId) { continue; }
      const issue = this.issues.get(k);
      if (issue?.source === 'local') {
        locals.push(issue);
      }
    }
    return Promise.resolve(locals);
  }

  updateIssueSource(workspaceId: string, issueKey: string, source: string): Promise<void> {
    const k = key(workspaceId, issueKey);
    const issue = this.issues.get(k);
    if (issue) {
      this.issues.set(k, { ...issue, source: source as 'jira' | 'local' });
    }
    return Promise.resolve();
  }

  // ─── Update issue fields ──────────────────────────────────────

  private readonly _modifiedKeys = new Set<string>();

  updateIssueFields(workspaceId: string, issueKey: string, fields: Partial<Issue>): Promise<void> {
    const k = key(workspaceId, issueKey);
    const issue = this.issues.get(k);
    if (!issue) {
      return Promise.reject(new Error(`Issue ${issueKey} not found`));
    }
    this.issues.set(k, { ...issue, ...fields });
    this._modifiedKeys.add(k);
    return Promise.resolve();
  }

  getModifiedIssues(workspaceId: string): Promise<(Issue & { modifiedFields: string[] })[]> {
    const modified: (Issue & { modifiedFields: string[] })[] = [];
    for (const k of this._modifiedKeys) {
      if (!k.startsWith(`${workspaceId}::`)) { continue; }
      const issue = this.issues.get(k);
      if (issue) {
        modified.push({ ...issue, modifiedFields: ['description'] });
      }
    }
    return Promise.resolve(modified);
  }

  clearModifiedFlag(workspaceId: string, issueKey: string): Promise<void> {
    this._modifiedKeys.delete(key(workspaceId, issueKey));
    return Promise.resolve();
  }

  // ─── Graph ────────────────────────────────────────────

  private readonly _graphEntities: (GraphEntity & { workspaceId: string })[] = [];
  private readonly _graphRelationships: (GraphRelationship & { workspaceId: string })[] = [];
  private readonly _graphObservations: (GraphObservation & { workspaceId: string })[] = [];

  saveGraphEntities(workspaceId: string, entities: GraphEntity[]): Promise<void> {
    for (const entity of entities) {
      const existing = this._graphEntities.find((e) =>
        e.workspaceId === workspaceId && e.name === entity.name && e.type === entity.type,
      );
      if (existing) {
        existing.properties = entity.properties;
      } else {
        this._graphEntities.push({
          ...entity,
          workspaceId,
          id: this._graphEntities.length + 1,
        });
      }
    }
    return Promise.resolve();
  }

  saveGraphRelationships(workspaceId: string, rels: GraphRelationship[]): Promise<void> {
    for (const rel of rels) {
      this._graphRelationships.push({
        ...rel,
        workspaceId,
        id: this._graphRelationships.length + 1,
      });
    }
    return Promise.resolve();
  }

  saveGraphObservation(
    workspaceId: string,
    entityId: number,
    content: string,
    author: string,
  ): Promise<void> {
    this._graphObservations.push({
      id: this._graphObservations.length + 1,
      entityId,
      content,
      author,
      workspaceId,
    });
    return Promise.resolve();
  }

  getObservations(workspaceId: string, entityId: number): Promise<GraphObservation[]> {
    return Promise.resolve(this._graphObservations
      .filter((o) => o.workspaceId === workspaceId && o.entityId === entityId)
      .map(({ workspaceId: _w, ...rest }) => rest));
  }

  queryGraph(workspaceId: string, entityName: string, _depth: number): Promise<GraphQueryResult> {
    const matched = this._graphEntities.filter((e) =>
      e.workspaceId === workspaceId && e.name.includes(entityName),
    );
    const ids = new Set(matched.map((e) => e.id));
    const rels = this._graphRelationships.filter((r) =>
      r.workspaceId === workspaceId && (ids.has(r.sourceId) || ids.has(r.targetId)),
    );
    const obs = this._graphObservations.filter((o) =>
      o.workspaceId === workspaceId && ids.has(o.entityId),
    );
    return Promise.resolve({
      entities: matched.map(({ workspaceId: _w, ...rest }) => rest),
      relationships: rels.map(({ workspaceId: _w, ...rest }) => rest),
      observations: obs.map(({ workspaceId: _w, ...rest }) => rest),
    });
  }

  getGraphStats(workspaceId: string): Promise<GraphStats> {
    const entities = this._graphEntities.filter((e) => e.workspaceId === workspaceId);
    const rels = this._graphRelationships.filter((r) => r.workspaceId === workspaceId);
    const obs = this._graphObservations.filter((o) => o.workspaceId === workspaceId);
    const byEntityType: Record<string, number> = {};
    for (const e of entities) { byEntityType[e.type] = (byEntityType[e.type] ?? 0) + 1; }
    const byRelationshipType: Record<string, number> = {};
    for (const r of rels) { byRelationshipType[r.type] = (byRelationshipType[r.type] ?? 0) + 1; }
    return Promise.resolve({
      entityCount: entities.length,
      relationshipCount: rels.length,
      observationCount: obs.length,
      byEntityType,
      byRelationshipType,
    });
  }

  clearGraph(workspaceId: string): Promise<void> {
    for (let i = this._graphRelationships.length - 1; i >= 0; i--) {
      const r = this._graphRelationships[i];
      if (r && r.workspaceId === workspaceId && r.source !== 'claude') {
        this._graphRelationships.splice(i, 1);
      }
    }
    return Promise.resolve();
  }

  // ─── Test helpers ─────────────────────────────────────────────

  seed(workspaceId: string, issues: Issue[]): void {
    for (const issue of issues) {
      const k = key(workspaceId, issue.key);
      this.issues.set(k, issue);
      this._workspaceIssues.set(k, workspaceId);
    }
  }

  seedLastUpdated(workspaceId: string, projectKey: string, timestamp: string): void {
    this._lastUpdated.set(key(workspaceId, projectKey), timestamp);
  }

  clear(): void {
    this.issues.clear();
    this._workspaceIssues.clear();
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
    this._modifiedKeys.clear();
    this._graphEntities.length = 0;
    this._graphRelationships.length = 0;
    this._graphObservations.length = 0;
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
