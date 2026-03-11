import type pg from 'pg';
import type { IStorage, QueryResult } from '../../core/ports/storage.js';
import type { IssueBatch } from '../../core/types/index.js';
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

      // Upsert issues
      for (const issue of batch.issues) {
        await client.query(
          `INSERT INTO issues (
            issue_key, issue_id, project_key, summary, description,
            issue_type, status, status_category, priority, resolution,
            assignee, reporter, created, updated, resolved,
            due_date, labels, components, fix_versions, parent_key,
            sprint, story_points, custom_fields, raw_json, pulled_at,
            search_vector
          ) VALUES (
            $1, $2, $3, $4, $5,
            $6, $7, $8, $9, $10,
            $11, $12, $13, $14, $15,
            $16, $17, $18, $19, $20,
            $21, $22, $23, $24, NOW(),
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
            reporter = EXCLUDED.reporter,
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
            custom_fields = EXCLUDED.custom_fields,
            raw_json = EXCLUDED.raw_json,
            pulled_at = NOW(),
            search_vector = to_tsvector('english', coalesce(EXCLUDED.summary, '') || ' ' || coalesce(EXCLUDED.description, ''))
          `,
          [
            issue.key, issue.id, issue.projectKey, issue.summary, issue.description,
            issue.issueType, issue.status, issue.statusCategory, issue.priority, issue.resolution,
            issue.assignee, issue.reporter, issue.created, issue.updated, issue.resolved,
            issue.dueDate, issue.labels, issue.components, issue.fixVersions, issue.parentKey,
            issue.sprint, issue.storyPoints, JSON.stringify(issue.customFields), JSON.stringify(issue.rawJson),
          ]
        );
      }

      // Delete old comments/changelogs/worklogs/links for these issues, then re-insert
      const issueKeys = batch.issues.map((i) => i.key);
      if (issueKeys.length > 0) {
        const keysParam = issueKeys.map((_, i) => `$${i + 1}`).join(',');

        await client.query(`DELETE FROM issue_comments WHERE issue_key IN (${keysParam})`, issueKeys);
        await client.query(`DELETE FROM issue_changelogs WHERE issue_key IN (${keysParam})`, issueKeys);
        await client.query(`DELETE FROM issue_worklogs WHERE issue_key IN (${keysParam})`, issueKeys);
        await client.query(`DELETE FROM issue_links WHERE source_key IN (${keysParam})`, issueKeys);
      }

      // Insert comments
      for (const c of batch.comments) {
        await client.query(
          `INSERT INTO issue_comments (issue_key, comment_id, author, body, created, updated)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [c.issueKey, c.commentId, c.author, c.body, c.created, c.updated]
        );
      }

      // Insert changelogs
      for (const ch of batch.changelogs) {
        await client.query(
          `INSERT INTO issue_changelogs (issue_key, author, field, from_value, to_value, changed_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [ch.issueKey, ch.author, ch.field, ch.fromValue, ch.toValue, ch.changedAt]
        );
      }

      // Insert worklogs
      for (const w of batch.worklogs) {
        await client.query(
          `INSERT INTO issue_worklogs (issue_key, author, time_spent, time_spent_seconds, comment, started)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [w.issueKey, w.author, w.timeSpent, w.timeSpentSeconds, w.comment, w.started]
        );
      }

      // Insert links
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

  async query(sql: string, params: unknown[]): Promise<QueryResult> {
    const result = await this.pool.query(sql, params);
    return { rows: result.rows as Record<string, unknown>[] };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
