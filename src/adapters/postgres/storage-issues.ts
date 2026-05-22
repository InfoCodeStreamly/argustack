import type pg from 'pg';
import type { Issue, IssueBatch } from '../../core/types/index.js';
import { adfToMarkdown } from '../../workspace/adf.js';

/**
 * Per-aggregate storage module: Jira issues + their children
 * (comments, changelogs, worklogs, links) plus local-edit tracking.
 *
 * Sibling modules (`storage-commits`, `storage-prs`, ...) own their
 * own tables; the top-level `PostgresStorage` orchestrator delegates
 * by method name. Splitting per aggregate keeps the file under the
 * 900-line architecture guard and gives each domain a focused SQL
 * surface.
 */
export class PostgresIssueStorage {
  constructor(private readonly pool: pg.Pool) {}

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
        const keysParam = issueKeys.map((_, i) => `$${String(i + 2)}`).join(',');

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

  async getLastUpdated(workspaceId: string, projectKey: string): Promise<string | null> {
    interface LastUpdatedRow {
      last_updated: string | null;
    }
    const result = await this.pool.query<LastUpdatedRow>(
      `SELECT MAX(updated) as last_updated FROM issues WHERE workspace_id = $1 AND project_key = $2`,
      [workspaceId, projectKey],
    );
    const raw = result.rows[0]?.last_updated;
    if (raw === null || raw === undefined || raw === '') {
      return null;
    }
    return new Date(raw).toISOString();
  }

  async getLocalIssues(workspaceId: string): Promise<Issue[]> {
    const result = await this.pool.query(
      `SELECT * FROM issues WHERE workspace_id = $1 AND source = 'local' ORDER BY created`,
      [workspaceId],
    );
    return result.rows.map((row) => mapRowToIssue(row as Record<string, unknown>));
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
        ...mapRowToIssue(r),
        modifiedFields: (r['modified_fields'] as string[] | null) ?? [],
      };
    });
  }

  async clearModifiedFlag(workspaceId: string, issueKey: string): Promise<void> {
    await this.pool.query(
      `UPDATE issues SET locally_modified = false, modified_at = NULL
       WHERE workspace_id = $1 AND issue_key = $2`,
      [workspaceId, issueKey],
    );
  }
}

function normalizeDescription(desc: string | null): string | null {
  if (desc === null || desc === '') {
    return desc;
  }
  if (desc.startsWith('{"type":"doc"')) {
    return adfToMarkdown(desc);
  }
  return desc;
}

function mapRowToIssue(row: Record<string, unknown>): Issue {
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
