import type pg from 'pg';
import type { IStorage, QueryResult } from '../../core/ports/storage.js';
import type { IssueBatch, HybridSearchResult } from '../../core/types/index.js';
import type { CommitBatch } from '../../core/types/git.js';
import type { GitHubBatch, Release } from '../../core/types/github.js';
import type { DbSchemaBatch } from '../../core/types/database.js';
import { createPool, type DbConfig } from './connection.js';
import { ensureSchema } from './schema.js';

/**
 * PostgreSQL adapter — implements IStorage.
 *
 * Uses UPSERT (ON CONFLICT) so re-pulling is safe and idempotent.
 */
export class PostgresStorage implements IStorage {
  readonly name = 'PostgreSQL';
  private readonly pool: pg.Pool;

  constructor(config: DbConfig) {
    this.pool = createPool(config);
  }

  async initialize(): Promise<void> {
    await ensureSchema(this.pool);
  }

  async saveBatch(batch: IssueBatch): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      for (const issue of batch.issues) {
        await client.query(
          `INSERT INTO issues (
            issue_key, issue_id, project_key, summary, description,
            issue_type, status, status_category, priority, resolution,
            assignee, assignee_id, reporter, reporter_id, created, updated, resolved,
            due_date, labels, components, fix_versions, parent_key,
            sprint, story_points, original_estimate, remaining_estimate, time_spent,
            custom_fields, raw_json, pulled_at,
            search_vector
          ) VALUES (
            $1, $2, $3, $4, $5,
            $6, $7, $8, $9, $10,
            $11, $12, $13, $14, $15, $16, $17,
            $18, $19, $20, $21, $22,
            $23, $24, $25, $26, $27,
            $28, $29, NOW(),
            to_tsvector('english', coalesce($4, '') || ' ' || coalesce($5, ''))
          )
          ON CONFLICT (issue_key) DO UPDATE SET
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
            pulled_at = NOW(),
            search_vector = to_tsvector('english', coalesce(EXCLUDED.summary, '') || ' ' || coalesce(EXCLUDED.description, ''))
          `,
          [
            issue.key, issue.id, issue.projectKey, issue.summary, issue.description,
            issue.issueType, issue.status, issue.statusCategory, issue.priority, issue.resolution,
            issue.assignee, issue.assigneeId, issue.reporter, issue.reporterId, issue.created, issue.updated, issue.resolved,
            issue.dueDate, issue.labels, issue.components, issue.fixVersions, issue.parentKey,
            issue.sprint, issue.storyPoints, issue.originalEstimate, issue.remainingEstimate, issue.timeSpent,
            JSON.stringify(issue.customFields), JSON.stringify(issue.rawJson),
          ]
        );
      }

      const issueKeys = batch.issues.map((i) => i.key);
      if (issueKeys.length > 0) {
        const keysParam = issueKeys.map((_, i) => `$${i + 1}`).join(',');

        await client.query(`DELETE FROM issue_comments WHERE issue_key IN (${keysParam})`, issueKeys);
        await client.query(`DELETE FROM issue_changelogs WHERE issue_key IN (${keysParam})`, issueKeys);
        await client.query(`DELETE FROM issue_worklogs WHERE issue_key IN (${keysParam})`, issueKeys);
        await client.query(`DELETE FROM issue_links WHERE source_key IN (${keysParam})`, issueKeys);
      }

      for (const c of batch.comments) {
        await client.query(
          `INSERT INTO issue_comments (issue_key, comment_id, author, body, created, updated)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [c.issueKey, c.commentId, c.author, c.body, c.created, c.updated]
        );
      }

      for (const ch of batch.changelogs) {
        await client.query(
          `INSERT INTO issue_changelogs (issue_key, author, field, from_value, to_value, changed_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [ch.issueKey, ch.author, ch.field, ch.fromValue, ch.toValue, ch.changedAt]
        );
      }

      for (const w of batch.worklogs) {
        await client.query(
          `INSERT INTO issue_worklogs (issue_key, author, time_spent, time_spent_seconds, comment, started)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [w.issueKey, w.author, w.timeSpent, w.timeSpentSeconds, w.comment, w.started]
        );
      }

      for (const l of batch.links) {
        await client.query(
          `INSERT INTO issue_links (source_key, target_key, link_type, direction)
           VALUES ($1, $2, $3, $4)`,
          [l.sourceKey, l.targetKey, l.linkType, l.direction]
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

  async saveCommitBatch(batch: CommitBatch): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      for (const commit of batch.commits) {
        await client.query(
          `INSERT INTO commits (hash, message, author, email, committed_at, parents, repo_path, pulled_at, search_vector)
           VALUES ($1, $2::text, $3::text, $4::text, $5, $6::text[], $7::text, NOW(),
             to_tsvector('english', coalesce($2::text, '') || ' ' || coalesce($3::text, ''))
           )
           ON CONFLICT (hash) DO UPDATE SET
             message = EXCLUDED.message,
             author = EXCLUDED.author,
             email = EXCLUDED.email,
             committed_at = EXCLUDED.committed_at,
             parents = EXCLUDED.parents,
             repo_path = EXCLUDED.repo_path,
             pulled_at = NOW(),
             search_vector = to_tsvector('english', coalesce(EXCLUDED.message, '') || ' ' || coalesce(EXCLUDED.author, ''))`,
          [commit.hash, commit.message, commit.author, commit.email, commit.committedAt, commit.parents, commit.repoPath]
        );
      }

      const hashes = batch.commits.map((c) => c.hash);
      if (hashes.length > 0) {
        const hashesParam = hashes.map((_, i) => `$${i + 1}`).join(',');
        await client.query(`DELETE FROM commit_files WHERE commit_hash IN (${hashesParam})`, hashes);
        await client.query(`DELETE FROM commit_issue_refs WHERE commit_hash IN (${hashesParam})`, hashes);
      }

      for (const file of batch.files) {
        await client.query(
          `INSERT INTO commit_files (commit_hash, file_path, status, additions, deletions)
           VALUES ($1, $2, $3, $4, $5)`,
          [file.commitHash, file.filePath, file.status, file.additions, file.deletions]
        );
      }

      for (const ref of batch.issueRefs) {
        await client.query(
          `INSERT INTO commit_issue_refs (commit_hash, issue_key)
           VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [ref.commitHash, ref.issueKey]
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

  async getLastCommitDate(repoPath: string): Promise<Date | null> {
    interface LastCommitRow {
      last_date: Date | null;
    }
    const result = await this.pool.query<LastCommitRow>(
      `SELECT MAX(committed_at) as last_date FROM commits WHERE repo_path = $1`,
      [repoPath]
    );
    return result.rows[0]?.last_date ?? null;
  }

  async getLastUpdated(projectKey: string): Promise<string | null> {
    interface LastUpdatedRow {
      last_updated: string | null;
    }
    const result = await this.pool.query<LastUpdatedRow>(
      `SELECT MAX(updated) as last_updated FROM issues WHERE project_key = $1`,
      [projectKey]
    );
    return result.rows[0]?.last_updated ?? null;
  }

  async saveGitHubBatch(batch: GitHubBatch): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      for (const pr of batch.pullRequests) {
        await client.query(
          `INSERT INTO pull_requests (
            number, repo_full_name, title, body, state, author,
            created_at, updated_at, merged_at, closed_at,
            merge_commit_sha, head_ref, base_ref,
            labels, reviewers, additions, deletions, changed_files,
            raw_json, pulled_at, search_vector
          ) VALUES (
            $1, $2, $3::text, $4::text, $5, $6,
            $7, $8, $9, $10,
            $11, $12, $13,
            $14::text[], $15::text[], $16, $17, $18,
            $19, NOW(),
            to_tsvector('english', coalesce($3::text, '') || ' ' || coalesce($4::text, ''))
          )
          ON CONFLICT (repo_full_name, number) DO UPDATE SET
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
            pr.number, pr.repoFullName, pr.title, pr.body, pr.state, pr.author,
            pr.createdAt, pr.updatedAt, pr.mergedAt, pr.closedAt,
            pr.mergeCommitSha, pr.headRef, pr.baseRef,
            pr.labels, pr.reviewers, pr.additions, pr.deletions, pr.changedFiles,
            JSON.stringify(pr.rawJson),
          ]
        );
      }

      const prNumbers = batch.pullRequests.map((p) => p.number);
      const repoName = batch.pullRequests[0]?.repoFullName;
      if (prNumbers.length > 0 && repoName) {
        const prParams = prNumbers.map((_, i) => `$${i + 2}`).join(',');
        await client.query(
          `DELETE FROM pr_reviews WHERE repo_full_name = $1 AND pr_number IN (${prParams})`,
          [repoName, ...prNumbers],
        );
        await client.query(
          `DELETE FROM pr_comments WHERE repo_full_name = $1 AND pr_number IN (${prParams})`,
          [repoName, ...prNumbers],
        );
        await client.query(
          `DELETE FROM pr_files WHERE repo_full_name = $1 AND pr_number IN (${prParams})`,
          [repoName, ...prNumbers],
        );
        await client.query(
          `DELETE FROM pr_issue_refs WHERE repo_full_name = $1 AND pr_number IN (${prParams})`,
          [repoName, ...prNumbers],
        );
      }

      for (const r of batch.reviews) {
        await client.query(
          `INSERT INTO pr_reviews (pr_number, repo_full_name, review_id, reviewer, state, body, submitted_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [r.prNumber, r.repoFullName, r.reviewId, r.reviewer, r.state, r.body, r.submittedAt],
        );
      }

      for (const c of batch.comments) {
        await client.query(
          `INSERT INTO pr_comments (pr_number, repo_full_name, comment_id, author, body, path, line, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [c.prNumber, c.repoFullName, c.commentId, c.author, c.body, c.path, c.line, c.createdAt, c.updatedAt],
        );
      }

      for (const f of batch.files) {
        await client.query(
          `INSERT INTO pr_files (pr_number, repo_full_name, file_path, status, additions, deletions)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [f.prNumber, f.repoFullName, f.filePath, f.status, f.additions, f.deletions],
        );
      }

      for (const ref of batch.issueRefs) {
        await client.query(
          `INSERT INTO pr_issue_refs (pr_number, repo_full_name, issue_key)
           VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING`,
          [ref.prNumber, ref.repoFullName, ref.issueKey],
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

  async saveReleases(releases: Release[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      for (const rel of releases) {
        await client.query(
          `INSERT INTO releases (
            id, repo_full_name, tag_name, name, body, author,
            draft, prerelease, created_at, published_at,
            raw_json, pulled_at, search_vector
          ) VALUES (
            $1, $2, $3, $4::text, $5::text, $6,
            $7, $8, $9, $10,
            $11, NOW(),
            to_tsvector('english', coalesce($4::text, '') || ' ' || coalesce($5::text, '') || ' ' || coalesce($3, ''))
          )
          ON CONFLICT (repo_full_name, id) DO UPDATE SET
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
            rel.id, rel.repoFullName, rel.tagName, rel.name, rel.body, rel.author,
            rel.draft, rel.prerelease, rel.createdAt, rel.publishedAt,
            JSON.stringify(rel.rawJson),
          ]
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

  async getLastPrUpdated(repoFullName: string): Promise<Date | null> {
    interface LastPrRow {
      last_updated: Date | null;
    }
    const result = await this.pool.query<LastPrRow>(
      `SELECT MAX(updated_at) as last_updated FROM pull_requests WHERE repo_full_name = $1`,
      [repoFullName],
    );
    return result.rows[0]?.last_updated ?? null;
  }

  async getUnembeddedIssueKeys(limit: number): Promise<string[]> {
    interface KeyRow {
      issue_key: string;
    }
    const result = await this.pool.query<KeyRow>(
      `SELECT issue_key FROM issues WHERE embedding IS NULL ORDER BY updated DESC NULLS LAST LIMIT $1`,
      [limit],
    );
    return result.rows.map((r) => r.issue_key);
  }

  async saveEmbedding(issueKey: string, vector: number[]): Promise<void> {
    await this.pool.query(
      `UPDATE issues SET embedding = $1 WHERE issue_key = $2`,
      [`[${vector.join(',')}]`, issueKey],
    );
  }

  async semanticSearch(
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
      ? `AND 1 - (embedding <=> $1::vector) >= ${String(threshold)}`
      : '';

    const result = await this.pool.query<SimilarityRow>(
      `SELECT issue_key, 1 - (embedding <=> $1::vector) AS similarity
       FROM issues
       WHERE embedding IS NOT NULL ${thresholdClause}
       ORDER BY embedding <=> $1::vector
       LIMIT $2`,
      [vectorStr, limit],
    );

    return result.rows.map((r) => ({
      issueKey: r.issue_key,
      similarity: r.similarity,
    }));
  }

  async hybridSearch(
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
                1.0 / (${String(k)} + ROW_NUMBER() OVER (ORDER BY ts_rank_cd(search_vector, plainto_tsquery('english', $1)) DESC)) AS score,
                true AS in_text,
                false AS in_vector
         FROM issues
         WHERE search_vector @@ plainto_tsquery('english', $1)
         ORDER BY score DESC
         LIMIT $2`,
        [query, limit],
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
         SELECT issue_key, ROW_NUMBER() OVER (ORDER BY ts_rank_cd(search_vector, plainto_tsquery('english', $1)) DESC) AS rank
         FROM issues
         WHERE search_vector @@ plainto_tsquery('english', $1)
         LIMIT $3
       ),
       vector_search AS (
         SELECT issue_key, ROW_NUMBER() OVER (ORDER BY embedding <=> $2::vector) AS rank
         FROM issues
         WHERE embedding IS NOT NULL
           AND 1 - (embedding <=> $2::vector) >= ${String(minSimilarity)}
         LIMIT $3
       )
       SELECT COALESCE(t.issue_key, v.issue_key) AS issue_key,
              1.0 / (${String(k)} + COALESCE(t.rank, 1000)) + 1.0 / (${String(k)} + COALESCE(v.rank, 1000)) AS score,
              t.issue_key IS NOT NULL AS in_text,
              v.issue_key IS NOT NULL AS in_vector
       FROM text_search t
       FULL OUTER JOIN vector_search v ON t.issue_key = v.issue_key
       ORDER BY score DESC
       LIMIT $4`,
      [query, vectorStr, maxPerSource, limit],
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

  async query(sql: string, params: unknown[]): Promise<QueryResult> {
    const result = await this.pool.query(sql, params);
    return { rows: result.rows as Record<string, unknown>[] };
  }

  async saveDbSchemaBatch(batch: DbSchemaBatch, sourceName: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      for (const table of batch.tables) {
        await client.query(
          `INSERT INTO db_tables (source_name, table_schema, table_name, row_count, size_bytes)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (source_name, table_schema, table_name) DO UPDATE SET
             row_count = EXCLUDED.row_count,
             size_bytes = EXCLUDED.size_bytes,
             pulled_at = NOW()`,
          [sourceName, table.schema, table.name, table.rowCount, table.sizeBytes],
        );

        for (const col of table.columns) {
          await client.query(
            `INSERT INTO db_columns (source_name, table_schema, table_name, column_name, data_type, is_nullable, default_value, is_primary_key, ordinal_position)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (source_name, table_schema, table_name, column_name) DO UPDATE SET
               data_type = EXCLUDED.data_type,
               is_nullable = EXCLUDED.is_nullable,
               default_value = EXCLUDED.default_value,
               is_primary_key = EXCLUDED.is_primary_key,
               ordinal_position = EXCLUDED.ordinal_position`,
            [sourceName, table.schema, table.name, col.name, col.dataType, col.nullable, col.defaultValue, col.isPrimaryKey, col.ordinalPosition],
          );
        }
      }

      for (const fk of batch.foreignKeys) {
        await client.query(
          `INSERT INTO db_foreign_keys (source_name, table_name, column_name, referenced_table, referenced_column)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (source_name, table_name, column_name, referenced_table, referenced_column) DO NOTHING`,
          [sourceName, fk.tableName, fk.columnName, fk.referencedTable, fk.referencedColumn],
        );
      }

      for (const idx of batch.indexes) {
        await client.query(
          `INSERT INTO db_indexes (source_name, table_name, index_name, columns, is_unique, is_primary)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (source_name, table_name, index_name) DO UPDATE SET
             columns = EXCLUDED.columns,
             is_unique = EXCLUDED.is_unique,
             is_primary = EXCLUDED.is_primary`,
          [sourceName, idx.tableName, idx.indexName, idx.columns, idx.isUnique, idx.isPrimary],
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

  async deleteDbSchema(sourceName: string): Promise<void> {
    await this.pool.query('DELETE FROM db_indexes WHERE source_name = $1', [sourceName]);
    await this.pool.query('DELETE FROM db_foreign_keys WHERE source_name = $1', [sourceName]);
    await this.pool.query('DELETE FROM db_columns WHERE source_name = $1', [sourceName]);
    await this.pool.query('DELETE FROM db_tables WHERE source_name = $1', [sourceName]);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
