import type { IStorage, QueryResult } from '../../core/ports/storage.js';
import type {
  Issue,
  IssueBatch,
  HybridSearchResult,
  GraphEntity,
  GraphRelationship,
  GraphObservation,
  GraphQueryResult,
  GraphStats,
} from '../../core/types/index.js';
import type { CommitBatch } from '../../core/types/git.js';
import type { GitHubBatch, Release } from '../../core/types/github.js';
import type { DbSchemaBatch } from '../../core/types/database.js';
import { createPool, type DbConfig } from './connection.js';
import { ensureSchema } from './schema.js';
import { PostgresCodeMetaStore } from './code-meta.js';
import { PostgresIssueStorage } from './storage-issues.js';
import { PostgresCommitStorage } from './storage-commits.js';
import { PostgresPullRequestStorage } from './storage-prs.js';
import { PostgresSearchStorage } from './storage-search.js';
import { PostgresDbSchemaStorage } from './storage-dbschema.js';
import { PostgresGraphStorage } from './storage-graph.js';
import { PostgresQueryStorage } from './storage-query.js';

/**
 * PostgreSQL adapter — implements {@link IStorage} + {@link ICodeMetaStore}
 * (via the {@link PostgresCodeMetaStore} base class).
 *
 * Composition over inheritance: this class is a thin orchestrator that
 * holds one specialized storage module per aggregate
 * (`storage-issues`, `storage-commits`, etc.) and delegates every
 * `IStorage` method to the matching module. Each module owns the SQL
 * for one table family and stays under the 900-line architectural
 * file-size cap.
 *
 * Every public method is scoped by `workspaceId` as the first
 * parameter and binds it to the tenant `workspace_id` column.
 */
export class PostgresStorage extends PostgresCodeMetaStore implements IStorage {
  readonly name = 'PostgreSQL';

  private readonly issues: PostgresIssueStorage;
  private readonly commits: PostgresCommitStorage;
  private readonly prs: PostgresPullRequestStorage;
  private readonly search: PostgresSearchStorage;
  private readonly dbSchema: PostgresDbSchemaStorage;
  private readonly graph: PostgresGraphStorage;
  private readonly query: PostgresQueryStorage;

  constructor(config: DbConfig) {
    super(createPool(config));
    this.issues = new PostgresIssueStorage(this.pool);
    this.commits = new PostgresCommitStorage(this.pool);
    this.prs = new PostgresPullRequestStorage(this.pool);
    this.search = new PostgresSearchStorage(this.pool);
    this.dbSchema = new PostgresDbSchemaStorage(this.pool);
    this.graph = new PostgresGraphStorage(this.pool);
    this.query = new PostgresQueryStorage(this.pool);
  }

  async initialize(): Promise<void> {
    await ensureSchema(this.pool);
  }

  async saveBatch(workspaceId: string, batch: IssueBatch): Promise<void> {
    await this.issues.saveBatch(workspaceId, batch);
  }

  async getLastUpdated(workspaceId: string, projectKey: string): Promise<string | null> {
    return this.issues.getLastUpdated(workspaceId, projectKey);
  }

  async getLocalIssues(workspaceId: string): Promise<Issue[]> {
    return this.issues.getLocalIssues(workspaceId);
  }

  async updateIssueSource(workspaceId: string, issueKey: string, source: string): Promise<void> {
    await this.issues.updateIssueSource(workspaceId, issueKey, source);
  }

  async updateIssueFields(workspaceId: string, issueKey: string, fields: Partial<Issue>): Promise<void> {
    await this.issues.updateIssueFields(workspaceId, issueKey, fields);
  }

  async getModifiedIssues(workspaceId: string): Promise<(Issue & { modifiedFields: string[] })[]> {
    return this.issues.getModifiedIssues(workspaceId);
  }

  async clearModifiedFlag(workspaceId: string, issueKey: string): Promise<void> {
    await this.issues.clearModifiedFlag(workspaceId, issueKey);
  }

  async saveCommitBatch(workspaceId: string, batch: CommitBatch): Promise<void> {
    await this.commits.saveCommitBatch(workspaceId, batch);
  }

  async getLastCommitDate(workspaceId: string, repoPath: string): Promise<Date | null> {
    return this.commits.getLastCommitDate(workspaceId, repoPath);
  }

  async saveGitHubBatch(workspaceId: string, batch: GitHubBatch): Promise<void> {
    await this.prs.saveGitHubBatch(workspaceId, batch);
  }

  async saveReleases(workspaceId: string, releases: Release[]): Promise<void> {
    await this.prs.saveReleases(workspaceId, releases);
  }

  async getLastPrUpdated(workspaceId: string, repoFullName: string): Promise<Date | null> {
    return this.prs.getLastPrUpdated(workspaceId, repoFullName);
  }

  async getUnembeddedIssueKeys(workspaceId: string, limit: number): Promise<string[]> {
    return this.search.getUnembeddedIssueKeys(workspaceId, limit);
  }

  async saveEmbedding(workspaceId: string, issueKey: string, vector: number[]): Promise<void> {
    await this.search.saveEmbedding(workspaceId, issueKey, vector);
  }

  async semanticSearch(
    workspaceId: string,
    vector: number[],
    limit: number,
    threshold?: number,
  ): Promise<{ issueKey: string; similarity: number }[]> {
    return this.search.semanticSearch(workspaceId, vector, limit, threshold);
  }

  async hybridSearch(
    workspaceId: string,
    query: string,
    vector: number[] | null,
    limit: number,
    threshold?: number,
  ): Promise<HybridSearchResult[]> {
    return this.search.hybridSearch(workspaceId, query, vector, limit, threshold);
  }

  async saveDbSchemaBatch(workspaceId: string, batch: DbSchemaBatch, sourceName: string): Promise<void> {
    await this.dbSchema.saveDbSchemaBatch(workspaceId, batch, sourceName);
  }

  async deleteDbSchema(workspaceId: string, sourceName: string): Promise<void> {
    await this.dbSchema.deleteDbSchema(workspaceId, sourceName);
  }

  async saveGraphEntities(workspaceId: string, entities: GraphEntity[]): Promise<void> {
    await this.graph.saveGraphEntities(workspaceId, entities);
  }

  async saveGraphRelationships(workspaceId: string, rels: GraphRelationship[]): Promise<void> {
    await this.graph.saveGraphRelationships(workspaceId, rels);
  }

  async saveGraphObservation(
    workspaceId: string,
    entityId: number,
    content: string,
    author: string,
  ): Promise<void> {
    await this.graph.saveGraphObservation(workspaceId, entityId, content, author);
  }

  async getObservations(workspaceId: string, entityId: number): Promise<GraphObservation[]> {
    return this.graph.getObservations(workspaceId, entityId);
  }

  async queryGraph(workspaceId: string, entityName: string, depth: number): Promise<GraphQueryResult> {
    return this.graph.queryGraph(workspaceId, entityName, depth);
  }

  async getGraphStats(workspaceId: string): Promise<GraphStats> {
    return this.graph.getGraphStats(workspaceId);
  }

  async clearGraph(workspaceId: string): Promise<void> {
    await this.graph.clearGraph(workspaceId);
  }

  async queryForWorkspace(workspaceId: string, sql: string, params: unknown[]): Promise<QueryResult> {
    return this.query.queryForWorkspace(workspaceId, sql, params);
  }

  async rawQuery(sql: string, params: unknown[]): Promise<QueryResult> {
    return this.query.rawQuery(sql, params);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
