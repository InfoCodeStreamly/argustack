import type pg from 'pg';
import type { CommitBatch } from '../../core/types/git.js';

/**
 * Per-aggregate storage module: Git commits + per-file diff + issue
 * cross-references. Orchestrated by `PostgresStorage`.
 */
export class PostgresCommitStorage {
  constructor(private readonly pool: pg.Pool) {}

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
            `${commit.message} ${commit.author}`,
          ],
        );
      }

      const hashes = batch.commits.map((c) => c.hash);
      if (hashes.length > 0) {
        const hashesParam = hashes.map((_, i) => `$${String(i + 2)}`).join(',');
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
}
