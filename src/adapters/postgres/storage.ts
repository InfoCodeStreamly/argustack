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
import { adfToMarkdown } from '../../workspace/adf.js';
import { PostgresCodeMetaStore } from './code-meta.js';

/**
 * Tenant tables that MUST appear with a `workspace_id` predicate when
 * referenced from {@link PostgresStorage.queryForWorkspace}. Used by the
 * runtime guard to refuse SQL that could leak data across workspaces.
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
function assertWorkspaceScoped(sql: string): void {
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
 * PostgreSQL adapter — implements IStorage + ICodeMetaStore (via base class).
 *
 * Every public IStorage method is scoped by `workspaceId` as the first
 * parameter and binds it to the tenant `workspace_id` column. Composite
 * UPSERTs use `(workspace_id, <natural key>)`.
 */
export class PostgresStorage extends PostgresCodeMetaStore implements IStorage {
  readonly name = 'PostgreSQL';

  constructor(config: DbConfig) {
    super(createPool(config));
  }

  async initialize(): Promise<void> {
    await ensureSchema(this.pool);
  }

  async saveBatch(workspaceId: string, batch: IssueBatch): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      for (const issue of batch.issues) {
        await client.query(
          `INSERT INTO issues (
            workspace_id, issue_key, issue_id, project_key, summary, description,
            issue_type, status, status_category, priority, resolution,
            assignee, assignee_id, reporter, reporter_id, created, updated, resolved,
            due_date, labels, components, fix_versions, parent_key,
            sprint, story_points, original_estimate, remaining_estimate, time_spent,
            custom_fields, raw_json, source, pulled_at,
            search_vector
          ) VALUES (
            $1, $2, $3, $4, $5, $6,
            $7, $8, $9, $10, $11,
            $12, $13, $14, $15, $16, $17, $18,
            $19, $20, $21, $22, $23,
            $24, $25, $26, $27, $28,
            $29, $30, $31, NOW(),
            to_tsvector('english', $32)
          )
          ON CONFLICT (workspace_id, issue_key) DO UPDATE SET
            issue_id = EXCLUDED.issue_id,
            project_key = EXCLUDED.project_key,
            summary = EXCLUDED.summary,
            description = EXCLUDED.description,
            issue_type = EXCLUDED.issue_type,
            status = EXCLUDED.status,
            status_category = EXCLUDED.status_category,
            priority = EXCLUDED.priority,
            resolution = EXCLUDED.resolution,
            assignee = EXCLUDED.assignee,
            assignee_id = EXCLUDED.assignee_id,
            reporter = EXCLUDED.reporter,
            reporter_id = EXCLUDED.reporter_id,
            created = EXCLUDED.created,
            updated = EXCLUDED.updated,
            resolved = EXCLUDED.resolved,
            due_date = EXCLUDED.due_date,
            labels = EXCLUDED.labels,
            components = EXCLUDED.components,
            fix_versions = EXCLUDED.fix_versions,
            parent_key = EXCLUDED.parent_key,
            sprint = EXCLUDED.sprint,
            story_points = EXCLUDED.story_points,
            original_estimate = EXCLUDED.original_estimate,
            remaining_estimate = EXCLUDED.remaining_estimate,
            time_spent = EXCLUDED.time_spent,
            custom_fields = EXCLUDED.custom_fields,
            raw_json = EXCLUDED.raw_json,
            source = EXCLUDED.source,
            pulled_at = NOW(),
            search_vector = to_tsvector('english', coalesce(EXCLUDED.summary, '') || ' ' || coalesce(EXCLUDED.description, ''))
          `,
          [
            workspaceId, issue.key, issue.id, issue.projectKey, issue.summary, normalizeDescription(issue.description),
            issue.issueType, issue.status, issue.statusCategory, issue.priority, issue.resolution,
            issue.assignee, issue.assigneeId, issue.reporter, issue.reporterId, issue.created, issue.updated, issue.resolved,
            issue.dueDate, issue.labels, issue.components, issue.fixVersions, issue.parentKey,
            issue.sprint, issue.storyPoints, issue.originalEstimate, issue.remainingEstimate, issue.timeSpent,
            JSON.stringify(issue.customFields), JSON.stringify(issue.rawJson), issue.source ?? 'jira',
            [issue.summary, normalizeDescription(issue.description)].filter(Boolean).join(' '),
          ],
        );
      }

      const issueKeys = batch.issues.map((i) => i.key);
      if (issueKeys.length > 0) {
        const keysParam = issueKeys.map((_, i) => `$${i + 2}`).join(',');

        await client.query(
          `DELETE FROM issue_comments WHERE workspace_id = $1 AND issue_key IN (${keysParam})`,
          [workspaceId, ...issueKeys],
        );
        await client.query(
          `DELETE FROM issue_changelogs WHERE workspace_id = $1 AND issue_key IN (${keysParam})`,
          [workspaceId, ...issueKeys],
        );
        await client.query(
          `DELETE FROM issue_worklogs WHERE workspace_id = $1 AND issue_key IN (${keysParam})`,
          [workspaceId, ...issueKeys],
        );
        await client.query(
          `DELETE FROM issue_links WHERE workspace_id = $1 AND source_key IN (${keysParam})`,
          [workspaceId, ...issueKeys],
        );
      }

      for (const c of batch.comments) {
        await client.query(
          `INSERT INTO issue_comments (workspace_id, issue_key, comment_id, author, body, created, updated)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [workspaceId, c.issueKey, c.commentId, c.author, c.body, c.created, c.updated],
        );
      }

      for (const ch of batch.changelogs) {
        await client.query(
          `INSERT INTO issue_changelogs (workspace_id, issue_key, author, field, from_value, to_value, changed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [workspaceId, ch.issueKey, ch.author, ch.field, ch.fromValue, ch.toValue, ch.changedAt],
        );
      }

      for (const w of batch.worklogs) {
        await client.query(
          `INSERT INTO issue_worklogs (workspace_id, issue_key, author, time_spent, time_spent_seconds, comment, started)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [workspaceId, w.issueKey, w.author, w.timeSpent, w.timeSpentSeconds, w.comment, w.started],
        );
      }

      for (const l of batch.links) {
        await client.query(
          `INSERT INTO issue_links (workspace_id, source_key, target_key, link_type, direction)
           VALUES ($1, $2, $3, $4, $5)`,
          [workspaceId, l.sourceKey, l.targetKey, l.linkType, l.direction],
        );
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async saveCommitBatch(workspaceId: string, batch: CommitBatch): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      for (const commit of batch.commits) {
        await client.query(
          `INSERT INTO commits (workspace_id, hash, message, author, email, committed_at, parents, repo_path, pulled_at, search_vector)
           VALUES ($1, $2, $3, $4, $5, $6, $7::text[], $8, NOW(),
             to_tsvector('english', $9)
           )
           ON CONFLICT (workspace_id, hash) DO UPDATE SET
             message = EXCLUDED.message,
             author = EXCLUDED.author,
             email = EXCLUDED.email,
             committed_at = EXCLUDED.committed_at,
             parents = EXCLUDED.parents,
             repo_path = EXCLUDED.repo_path,
             pulled_at = NOW(),
             search_vector = to_tsvector('english', coalesce(EXCLUDED.message, '') || ' ' || coalesce(EXCLUDED.author, ''))`,
          [
            workspaceId, commit.hash, commit.message, commit.author, commit.email,
            commit.committedAt, commit.parents, commit.repoPath,
            `${commit.message || ''} ${commit.author || ''}`,
          ],
        );
      }

      const hashes = batch.commits.map((c) => c.hash);
      if (hashes.length > 0) {
        const hashesParam = hashes.map((_, i) => `$${i + 2}`).join(',');
        await client.query(
          `DELETE FROM commit_files WHERE workspace_id = $1 AND commit_hash IN (${hashesParam})`,
          [workspaceId, ...hashes],
        );
        await client.query(
          `DELETE FROM commit_issue_refs WHERE workspace_id = $1 AND commit_hash IN (${hashesParam})`,
          [workspaceId, ...hashes],
        );
      }

      for (const file of batch.files) {
        await client.query(
          `INSERT INTO commit_files (workspace_id, commit_hash, file_path, status, additions, deletions)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [workspaceId, file.commitHash, file.filePath, file.status, file.additions, file.deletions],
        );
      }

      for (const ref of batch.issueRefs) {
        await client.query(
          `INSERT INTO commit_issue_refs (workspace_id, commit_hash, issue_key)
           VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING`,
          [workspaceId, ref.commitHash, ref.issueKey],
        );
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async getLastCommitDate(workspaceId: string, repoPath: string): Promise<Date | null> {
    interface LastCommitRow {
      last_date: Date | null;
    }
    const result = await this.pool.query<LastCommitRow>(
      `SELECT MAX(committed_at) as last_date FROM commits WHERE workspace_id = $1 AND repo_path = $2`,
      [workspaceId, repoPath],
    );
    return result.rows[0]?.last_date ?? null;
  }

  async getLastUpdated(workspaceId: string, projectKey: string): Promise<string | null> {
    interface LastUpdatedRow {
      last_updated: string | null;
    }
    const result = await this.pool.query<LastUpdatedRow>(
      `SELECT MAX(updated) as last_updated FROM issues WHERE workspace_id = $1 AND project_key = $2`,
      [workspaceId, projectKey],
    );
    const raw = result.rows[0]?.last_updated;
    if (!raw) {
      return null;
    }
    return new Date(raw).toISOString();
  }

  async saveGitHubBatch(workspaceId: string, batch: GitHubBatch): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      for (const pr of batch.pullRequests) {
        await client.query(
          `INSERT INTO pull_requests (
            workspace_id, number, repo_full_name, title, body, state, author,
            created_at, updated_at, merged_at, closed_at,
            merge_commit_sha, head_ref, base_ref,
            labels, reviewers, additions, deletions, changed_files,
            raw_json, pulled_at, search_vector
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7,
            $8, $9, $10, $11,
            $12, $13, $14,
            $15::text[], $16::text[], $17, $18, $19,
            $20, NOW(),
            to_tsvector('english', $21)
          )
          ON CONFLICT (workspace_id, repo_full_name, number) DO UPDATE SET
            title = EXCLUDED.title,
            body = EXCLUDED.body,
            state = EXCLUDED.state,
            author = EXCLUDED.author,
            created_at = EXCLUDED.created_at,
            updated_at = EXCLUDED.updated_at,
            merged_at = EXCLUDED.merged_at,
            closed_at = EXCLUDED.closed_at,
            merge_commit_sha = EXCLUDED.merge_commit_sha,
            head_ref = EXCLUDED.head_ref,
            base_ref = EXCLUDED.base_ref,
            labels = EXCLUDED.labels,
            reviewers = EXCLUDED.reviewers,
            additions = EXCLUDED.additions,
            deletions = EXCLUDED.deletions,
            changed_files = EXCLUDED.changed_files,
            raw_json = EXCLUDED.raw_json,
            pulled_at = NOW(),
            search_vector = to_tsvector('english', coalesce(EXCLUDED.title, '') || ' ' || coalesce(EXCLUDED.body, ''))`,
          [
            workspaceId, pr.number, pr.repoFullName, pr.title, pr.body, pr.state, pr.author,
            pr.createdAt, pr.updatedAt, pr.mergedAt, pr.closedAt,
            pr.mergeCommitSha, pr.headRef, pr.baseRef,
            pr.labels, pr.reviewers, pr.additions, pr.deletions, pr.changedFiles,
            JSON.stringify(pr.rawJson),
            [pr.title, pr.body].filter(Boolean).join(' '),
          ],
        );
      }

      const prNumbers = batch.pullRequests.map((p) => p.number);
      const repoName = batch.pullRequests[0]?.repoFullName;
      if (prNumbers.length > 0 && repoName) {
        const prParams = prNumbers.map((_, i) => `$${i + 3}`).join(',');
        await client.query(
          `DELETE FROM pr_reviews WHERE workspace_id = $1 AND repo_full_name = $2 AND pr_number IN (${prParams})`,
          [workspaceId, repoName, ...prNumbers],
        );
        await client.query(
          `DELETE FROM pr_comments WHERE workspace_id = $1 AND repo_full_name = $2 AND pr_number IN (${prParams})`,
          [workspaceId, repoName, ...prNumbers],
        );
        await client.query(
          `DELETE FROM pr_files WHERE workspace_id = $1 AND repo_full_name = $2 AND pr_number IN (${prParams})`,
          [workspaceId, repoName, ...prNumbers],
        );
        await client.query(
          `DELETE FROM pr_issue_refs WHERE workspace_id = $1 AND repo_full_name = $2 AND pr_number IN (${prParams})`,
          [workspaceId, repoName, ...prNumbers],
        );
      }

      for (const r of batch.reviews) {
        await client.query(
          `INSERT INTO pr_reviews (workspace_id, pr_number, repo_full_name, review_id, reviewer, state, body, submitted_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [workspaceId, r.prNumber, r.repoFullName, r.reviewId, r.reviewer, r.state, r.body, r.submittedAt],
        );
      }

      for (const c of batch.comments) {
        await client.query(
          `INSERT INTO pr_comments (workspace_id, pr_number, repo_full_name, comment_id, author, body, path, line, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [workspaceId, c.prNumber, c.repoFullName, c.commentId, c.author, c.body, c.path, c.line, c.createdAt, c.updatedAt],
        );
      }

      for (const f of batch.files) {
        await client.query(
          `INSERT INTO pr_files (workspace_id, pr_number, repo_full_name, file_path, status, additions, deletions)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [workspaceId, f.prNumber, f.repoFullName, f.filePath, f.status, f.additions, f.deletions],
        );
      }

      for (const ref of batch.issueRefs) {
        await client.query(
          `INSERT INTO pr_issue_refs (workspace_id, pr_number, repo_full_name, issue_key)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT DO NOTHING`,
          [workspaceId, ref.prNumber, ref.repoFullName, ref.issueKey],
        );
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async saveReleases(workspaceId: string, releases: Release[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      for (const rel of releases) {
        await client.query(
          `INSERT INTO releases (
            workspace_id, id, repo_full_name, tag_name, name, body, author,
            draft, prerelease, created_at, published_at,
            raw_json, pulled_at, search_vector
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7,
            $8, $9, $10, $11,
            $12, NOW(),
            to_tsvector('english', $13)
          )
          ON CONFLICT (workspace_id, repo_full_name, id) DO UPDATE SET
            tag_name = EXCLUDED.tag_name,
            name = EXCLUDED.name,
            body = EXCLUDED.body,
            author = EXCLUDED.author,
            draft = EXCLUDED.draft,
            prerelease = EXCLUDED.prerelease,
            created_at = EXCLUDED.created_at,
            published_at = EXCLUDED.published_at,
            raw_json = EXCLUDED.raw_json,
            pulled_at = NOW(),
            search_vector = to_tsvector('english', coalesce(EXCLUDED.name, '') || ' ' || coalesce(EXCLUDED.body, '') || ' ' || coalesce(EXCLUDED.tag_name, ''))`,
          [
            workspaceId, rel.id, rel.repoFullName, rel.tagName, rel.name, rel.body, rel.author,
            rel.draft, rel.prerelease, rel.createdAt, rel.publishedAt,
            JSON.stringify(rel.rawJson),
            [rel.name, rel.body, rel.tagName].filter(Boolean).join(' '),
          ],
        );
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async getLastPrUpdated(workspaceId: string, repoFullName: string): Promise<Date | null> {
    interface LastPrRow {
      last_updated: Date | null;
    }
    const result = await this.pool.query<LastPrRow>(
      `SELECT MAX(updated_at) as last_updated FROM pull_requests WHERE workspace_id = $1 AND repo_full_name = $2`,
      [workspaceId, repoFullName],
    );
    return result.rows[0]?.last_updated ?? null;
  }

  async getUnembeddedIssueKeys(workspaceId: string, limit: number): Promise<string[]> {
    interface KeyRow {
      issue_key: string;
    }
    const result = await this.pool.query<KeyRow>(
      `SELECT issue_key FROM issues
       WHERE workspace_id = $1 AND embedding IS NULL
       ORDER BY updated DESC NULLS LAST LIMIT $2`,
      [workspaceId, limit],
    );
    return result.rows.map((r) => r.issue_key);
  }

  async saveEmbedding(workspaceId: string, issueKey: string, vector: number[]): Promise<void> {
    await this.pool.query(
      `UPDATE issues SET embedding = $1 WHERE workspace_id = $2 AND issue_key = $3`,
      [`[${vector.join(',')}]`, workspaceId, issueKey],
    );
  }

  async semanticSearch(
    workspaceId: string,
    vector: number[],
    limit: number,
    threshold?: number,
  ): Promise<{ issueKey: string; similarity: number }[]> {
    interface SimilarityRow {
      issue_key: string;
      similarity: number;
    }
    const vectorStr = `[${vector.join(',')}]`;
    const thresholdClause = threshold !== undefined
      ? `AND 1 - (embedding <=> $2::vector) >= ${String(threshold)}`
      : '';

    const result = await this.pool.query<SimilarityRow>(
      `SELECT issue_key, 1 - (embedding <=> $2::vector) AS similarity
       FROM issues
       WHERE workspace_id = $1 AND embedding IS NOT NULL ${thresholdClause}
       ORDER BY embedding <=> $2::vector
       LIMIT $3`,
      [workspaceId, vectorStr, limit],
    );

    return result.rows.map((r) => ({
      issueKey: r.issue_key,
      similarity: r.similarity,
    }));
  }

  async hybridSearch(
    workspaceId: string,
    query: string,
    vector: number[] | null,
    limit: number,
    threshold?: number,
  ): Promise<HybridSearchResult[]> {
    interface HybridRow {
      issue_key: string;
      score: number;
      in_text: boolean;
      in_vector: boolean;
    }

    const k = 60;
    const maxPerSource = limit * 2;
    const minSimilarity = threshold ?? 0.5;

    if (!vector) {
      const result = await this.pool.query<HybridRow>(
        `SELECT issue_key,
                1.0 / (${String(k)} + ROW_NUMBER() OVER (ORDER BY ts_rank_cd(search_vector, plainto_tsquery('english', $2)) DESC)) AS score,
                true AS in_text,
                false AS in_vector
         FROM issues
         WHERE workspace_id = $1 AND search_vector @@ plainto_tsquery('english', $2)
         ORDER BY score DESC
         LIMIT $3`,
        [workspaceId, query, limit],
      );
      return result.rows.map((r) => ({
        issueKey: r.issue_key,
        score: r.score,
        source: 'text' as const,
      }));
    }

    const vectorStr = `[${vector.join(',')}]`;

    const result = await this.pool.query<HybridRow>(
      `WITH text_search AS (
         SELECT issue_key, ROW_NUMBER() OVER (ORDER BY ts_rank_cd(search_vector, plainto_tsquery('english', $2)) DESC) AS rank
         FROM issues
         WHERE workspace_id = $1 AND search_vector @@ plainto_tsquery('english', $2)
         LIMIT $4
       ),
       vector_search AS (
         SELECT issue_key, ROW_NUMBER() OVER (ORDER BY embedding <=> $3::vector) AS rank
         FROM issues
         WHERE workspace_id = $1 AND embedding IS NOT NULL
           AND 1 - (embedding <=> $3::vector) >= ${String(minSimilarity)}
         LIMIT $4
       )
       SELECT COALESCE(t.issue_key, v.issue_key) AS issue_key,
              1.0 / (${String(k)} + COALESCE(t.rank, 1000)) + 1.0 / (${String(k)} + COALESCE(v.rank, 1000)) AS score,
              t.issue_key IS NOT NULL AS in_text,
              v.issue_key IS NOT NULL AS in_vector
       FROM text_search t
       FULL OUTER JOIN vector_search v ON t.issue_key = v.issue_key
       ORDER BY score DESC
       LIMIT $5`,
      [workspaceId, query, vectorStr, maxPerSource, limit],
    );

    return result.rows.map((r) => {
      let source: HybridSearchResult['source'];
      if (r.in_text && r.in_vector) {
        source = 'both';
      } else if (r.in_text) {
        source = 'text';
      } else {
        source = 'semantic';
      }
      return { issueKey: r.issue_key, score: r.score, source };
    });
  }

  async queryForWorkspace(workspaceId: string, sql: string, params: unknown[]): Promise<QueryResult> {
    assertWorkspaceScoped(sql);
    const result = await this.pool.query(sql, [workspaceId, ...params]);
    return { rows: result.rows as Record<string, unknown>[] };
  }

  async rawQuery(sql: string, params: unknown[]): Promise<QueryResult> {
    const result = await this.pool.query(sql, params);
    return { rows: result.rows as Record<string, unknown>[] };
  }

  async saveDbSchemaBatch(workspaceId: string, batch: DbSchemaBatch, sourceName: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      for (const table of batch.tables) {
        await client.query(
          `INSERT INTO db_tables (workspace_id, source_name, table_schema, table_name, row_count, size_bytes)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (workspace_id, source_name, table_schema, table_name) DO UPDATE SET
             row_count = EXCLUDED.row_count,
             size_bytes = EXCLUDED.size_bytes,
             pulled_at = NOW()`,
          [workspaceId, sourceName, table.schema, table.name, table.rowCount, table.sizeBytes],
        );

        for (const col of table.columns) {
          await client.query(
            `INSERT INTO db_columns (workspace_id, source_name, table_schema, table_name, column_name, data_type, is_nullable, default_value, is_primary_key, ordinal_position)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             ON CONFLICT (workspace_id, source_name, table_schema, table_name, column_name) DO UPDATE SET
               data_type = EXCLUDED.data_type,
               is_nullable = EXCLUDED.is_nullable,
               default_value = EXCLUDED.default_value,
               is_primary_key = EXCLUDED.is_primary_key,
               ordinal_position = EXCLUDED.ordinal_position`,
            [workspaceId, sourceName, table.schema, table.name, col.name, col.dataType, col.nullable, col.defaultValue, col.isPrimaryKey, col.ordinalPosition],
          );
        }
      }

      for (const fk of batch.foreignKeys) {
        await client.query(
          `INSERT INTO db_foreign_keys (workspace_id, source_name, table_name, column_name, referenced_table, referenced_column)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (workspace_id, source_name, table_name, column_name, referenced_table, referenced_column) DO NOTHING`,
          [workspaceId, sourceName, fk.tableName, fk.columnName, fk.referencedTable, fk.referencedColumn],
        );
      }

      for (const idx of batch.indexes) {
        await client.query(
          `INSERT INTO db_indexes (workspace_id, source_name, table_name, index_name, columns, is_unique, is_primary)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (workspace_id, source_name, table_name, index_name) DO UPDATE SET
             columns = EXCLUDED.columns,
             is_unique = EXCLUDED.is_unique,
             is_primary = EXCLUDED.is_primary`,
          [workspaceId, sourceName, idx.tableName, idx.indexName, idx.columns, idx.isUnique, idx.isPrimary],
        );
      }

      await client.query('COMMIT');
    } catch (err: unknown) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async deleteDbSchema(workspaceId: string, sourceName: string): Promise<void> {
    await this.pool.query(
      'DELETE FROM db_indexes WHERE workspace_id = $1 AND source_name = $2',
      [workspaceId, sourceName],
    );
    await this.pool.query(
      'DELETE FROM db_foreign_keys WHERE workspace_id = $1 AND source_name = $2',
      [workspaceId, sourceName],
    );
    await this.pool.query(
      'DELETE FROM db_columns WHERE workspace_id = $1 AND source_name = $2',
      [workspaceId, sourceName],
    );
    await this.pool.query(
      'DELETE FROM db_tables WHERE workspace_id = $1 AND source_name = $2',
      [workspaceId, sourceName],
    );
  }

  async getLocalIssues(workspaceId: string): Promise<Issue[]> {
    const result = await this.pool.query(
      `SELECT * FROM issues WHERE workspace_id = $1 AND source = 'local' ORDER BY created`,
      [workspaceId],
    );
    return result.rows.map((row) => this.mapRowToIssue(row as Record<string, unknown>));
  }

  async updateIssueSource(workspaceId: string, issueKey: string, source: string): Promise<void> {
    await this.pool.query(
      `UPDATE issues SET source = $3 WHERE workspace_id = $1 AND issue_key = $2`,
      [workspaceId, issueKey, source],
    );
  }

  async updateIssueFields(workspaceId: string, issueKey: string, fields: Partial<Issue>): Promise<void> {
    const fieldMap: Record<string, unknown> = {};
    if (fields.summary !== undefined) { fieldMap['summary'] = fields.summary; }
    if (fields.description !== undefined) { fieldMap['description'] = fields.description; }
    if (fields.status !== undefined) { fieldMap['status'] = fields.status; }
    if (fields.priority !== undefined) { fieldMap['priority'] = fields.priority; }
    if (fields.assignee !== undefined) { fieldMap['assignee'] = fields.assignee; }
    if (fields.labels !== undefined) { fieldMap['labels'] = fields.labels; }
    if (fields.components !== undefined) { fieldMap['components'] = fields.components; }
    if (fields.storyPoints !== undefined) { fieldMap['story_points'] = fields.storyPoints; }

    const keys = Object.keys(fieldMap);
    if (keys.length === 0) {
      return;
    }

    const setClauses = keys.map((col, i) => `${col} = $${String(i + 3)}`);
    setClauses.push('locally_modified = true', 'modified_at = NOW()');
    setClauses.push(`modified_fields = $${String(keys.length + 3)}`);

    const values = keys.map((col) => fieldMap[col]);
    values.push(keys);
    const sql = `UPDATE issues SET ${setClauses.join(', ')} WHERE workspace_id = $1 AND issue_key = $2`;

    const result = await this.pool.query(sql, [workspaceId, issueKey, ...values]);
    if (result.rowCount === 0) {
      throw new Error(`Issue ${issueKey} not found in workspace ${workspaceId}`);
    }
  }

  async getModifiedIssues(workspaceId: string): Promise<(Issue & { modifiedFields: string[] })[]> {
    const result = await this.pool.query(
      `SELECT * FROM issues WHERE workspace_id = $1 AND locally_modified = true ORDER BY modified_at`,
      [workspaceId],
    );
    return result.rows.map((row) => {
      const r = row as Record<string, unknown>;
      return {
        ...this.mapRowToIssue(r),
        modifiedFields: (r['modified_fields'] as string[] | null) ?? [],
      };
    });
  }

  private mapRowToIssue(row: Record<string, unknown>): Issue {
    const str = (key: string): string => typeof row[key] === 'string' ? row[key] : '';
    const strNull = (key: string): string | null => typeof row[key] === 'string' ? row[key] : null;
    const numNull = (key: string): number | null => typeof row[key] === 'number' ? row[key] : null;
    const arr = (key: string): string[] => Array.isArray(row[key]) ? row[key] as string[] : [];

    return {
      key: str('issue_key'),
      id: str('issue_id'),
      projectKey: str('project_key'),
      summary: str('summary'),
      description: strNull('description'),
      issueType: strNull('issue_type'),
      status: strNull('status'),
      statusCategory: strNull('status_category'),
      priority: strNull('priority'),
      resolution: strNull('resolution'),
      assignee: strNull('assignee'),
      assigneeId: strNull('assignee_id'),
      reporter: strNull('reporter'),
      reporterId: strNull('reporter_id'),
      created: strNull('created'),
      updated: strNull('updated'),
      resolved: strNull('resolved'),
      dueDate: strNull('due_date'),
      labels: arr('labels'),
      components: arr('components'),
      fixVersions: arr('fix_versions'),
      parentKey: strNull('parent_key'),
      sprint: strNull('sprint'),
      storyPoints: numNull('story_points'),
      originalEstimate: numNull('original_estimate'),
      remainingEstimate: numNull('remaining_estimate'),
      timeSpent: numNull('time_spent'),
      customFields: (row['custom_fields'] as Record<string, unknown> | undefined) ?? {},
      rawJson: (row['raw_json'] as Record<string, unknown> | undefined) ?? {},
      source: (row['source'] as 'jira' | 'local' | undefined) ?? 'jira',
    };
  }

  async clearModifiedFlag(workspaceId: string, issueKey: string): Promise<void> {
    await this.pool.query(
      `UPDATE issues SET locally_modified = false, modified_at = NULL
       WHERE workspace_id = $1 AND issue_key = $2`,
      [workspaceId, issueKey],
    );
  }

  async saveGraphEntities(workspaceId: string, entities: GraphEntity[]): Promise<void> {
    for (const entity of entities) {
      await this.pool.query(
        `INSERT INTO graph_entities (workspace_id, name, type, properties)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (workspace_id, name, type) DO UPDATE SET properties = EXCLUDED.properties`,
        [workspaceId, entity.name, entity.type, JSON.stringify(entity.properties)],
      );
    }
  }

  async saveGraphRelationships(workspaceId: string, rels: GraphRelationship[]): Promise<void> {
    for (const rel of rels) {
      await this.pool.query(
        `INSERT INTO graph_relationships (workspace_id, source_id, target_id, type, weight, source, properties)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (workspace_id, source_id, target_id, type) DO UPDATE SET
           weight = EXCLUDED.weight,
           properties = EXCLUDED.properties`,
        [workspaceId, rel.sourceId, rel.targetId, rel.type, rel.weight, rel.source, JSON.stringify(rel.properties)],
      );
    }
  }

  async saveGraphObservation(
    workspaceId: string,
    entityId: number,
    content: string,
    author: string,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO graph_observations (workspace_id, entity_id, content, author) VALUES ($1, $2, $3, $4)`,
      [workspaceId, entityId, content, author],
    );
  }

  async getObservations(workspaceId: string, entityId: number): Promise<GraphObservation[]> {
    const result = await this.pool.query(
      `SELECT id, entity_id, content, author, created_at FROM graph_observations
       WHERE workspace_id = $1 AND entity_id = $2 ORDER BY created_at`,
      [workspaceId, entityId],
    );
    return result.rows.map((r: Record<string, unknown>) => ({
      id: r['id'] as number,
      entityId: r['entity_id'] as number,
      content: r['content'] as string,
      author: r['author'] as string,
      createdAt: r['created_at'] as string,
    }));
  }

  async queryGraph(workspaceId: string, entityName: string, depth: number): Promise<GraphQueryResult> {
    const result = await this.pool.query(
      `WITH RECURSIVE graph_walk AS (
        SELECT id, name, type, properties, 0 as depth
        FROM graph_entities WHERE workspace_id = $1 AND name ILIKE $2
        UNION
        SELECT e.id, e.name, e.type, e.properties, gw.depth + 1
        FROM graph_walk gw
        JOIN graph_relationships r
          ON r.workspace_id = $1
         AND (r.source_id = gw.id OR r.target_id = gw.id)
        JOIN graph_entities e
          ON e.workspace_id = $1
         AND e.id = CASE WHEN r.source_id = gw.id THEN r.target_id ELSE r.source_id END
        WHERE gw.depth < $3
      )
      SELECT DISTINCT id, name, type, properties FROM graph_walk LIMIT 200`,
      [workspaceId, `%${entityName}%`, depth],
    );

    const entityIds = result.rows.map((r: Record<string, unknown>) => r['id'] as number);
    const entities: GraphEntity[] = result.rows.map((r: Record<string, unknown>) => ({
      id: r['id'] as number,
      name: r['name'] as string,
      type: r['type'] as string,
      properties: r['properties'] as Record<string, unknown>,
    }));

    let relationships: GraphRelationship[] = [];
    let observations: GraphObservation[] = [];

    if (entityIds.length > 0) {
      const idList = entityIds.map((_, i) => `$${String(i + 2)}`).join(',');

      const relResult = await this.pool.query(
        `SELECT id, source_id, target_id, type, weight, source, properties
         FROM graph_relationships
         WHERE workspace_id = $1
           AND (source_id IN (${idList}) OR target_id IN (${idList}))`,
        [workspaceId, ...entityIds],
      );
      relationships = relResult.rows.map((r: Record<string, unknown>) => ({
        id: r['id'] as number,
        sourceId: r['source_id'] as number,
        targetId: r['target_id'] as number,
        type: r['type'] as string,
        weight: Number(r['weight']),
        source: r['source'] as 'structural' | 'claude' | 'auto',
        properties: r['properties'] as Record<string, unknown>,
      }));

      const obsResult = await this.pool.query(
        `SELECT id, entity_id, content, author, created_at
         FROM graph_observations
         WHERE workspace_id = $1 AND entity_id IN (${idList})`,
        [workspaceId, ...entityIds],
      );
      observations = obsResult.rows.map((r: Record<string, unknown>) => ({
        id: r['id'] as number,
        entityId: r['entity_id'] as number,
        content: r['content'] as string,
        author: r['author'] as string,
        createdAt: r['created_at'] as string,
      }));
    }

    return { entities, relationships, observations };
  }

  async getGraphStats(workspaceId: string): Promise<GraphStats> {
    const entityResult = await this.pool.query(
      `SELECT type, COUNT(*) as cnt FROM graph_entities WHERE workspace_id = $1 GROUP BY type`,
      [workspaceId],
    );
    const relResult = await this.pool.query(
      `SELECT type, COUNT(*) as cnt FROM graph_relationships WHERE workspace_id = $1 GROUP BY type`,
      [workspaceId],
    );
    const obsResult = await this.pool.query(
      `SELECT COUNT(*) as cnt FROM graph_observations WHERE workspace_id = $1`,
      [workspaceId],
    );

    const byEntityType: Record<string, number> = {};
    let entityCount = 0;
    for (const row of entityResult.rows as Record<string, unknown>[]) {
      const count = Number(row['cnt']);
      byEntityType[row['type'] as string] = count;
      entityCount += count;
    }

    const byRelationshipType: Record<string, number> = {};
    let relationshipCount = 0;
    for (const row of relResult.rows as Record<string, unknown>[]) {
      const count = Number(row['cnt']);
      byRelationshipType[row['type'] as string] = count;
      relationshipCount += count;
    }

    const firstRow = obsResult.rows[0] as Record<string, unknown> | undefined;
    const observationCount = Number(firstRow?.['cnt'] ?? 0);

    return { entityCount, relationshipCount, observationCount, byEntityType, byRelationshipType };
  }

  async clearGraph(workspaceId: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM graph_relationships
       WHERE workspace_id = $1 AND source IN ('structural', 'auto')`,
      [workspaceId],
    );
    await this.pool.query(
      `DELETE FROM graph_entities
       WHERE workspace_id = $1
         AND id NOT IN (
           SELECT DISTINCT source_id FROM graph_relationships WHERE workspace_id = $1
           UNION SELECT DISTINCT target_id FROM graph_relationships WHERE workspace_id = $1
         )
         AND id NOT IN (SELECT DISTINCT entity_id FROM graph_observations WHERE workspace_id = $1)`,
      [workspaceId],
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

function normalizeDescription(desc: string | null): string | null {
  if (!desc) {
    return desc;
  }
  if (desc.startsWith('{"type":"doc"')) {
    return adfToMarkdown(desc);
  }
  return desc;
}
