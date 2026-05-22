import type pg from 'pg';
import type { GitHubBatch, Release } from '../../core/types/github.js';

/**
 * Per-aggregate storage module: GitHub pull requests, reviews,
 * comments, per-file diffs, issue refs, and releases. Orchestrated by
 * `PostgresStorage`.
 */
export class PostgresPullRequestStorage {
  constructor(private readonly pool: pg.Pool) {}

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
      if (prNumbers.length > 0 && repoName !== undefined && repoName !== '') {
        const prParams = prNumbers.map((_, i) => `$${String(i + 3)}`).join(',');
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
}
