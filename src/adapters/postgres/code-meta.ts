import type pg from 'pg';
import type { ICodeMetaStore } from '../../core/ports/code-meta.js';
import type {
  CodeProject,
  CodeFileHash,
  CodeLayer,
  IndexJob,
  IndexJobType,
  IndexStats,
} from '../../core/types/index.js';

interface CodeProjectRow {
  id: string;
  name: string;
  root_path: string;
  language: string;
  layer_config: Record<string, string> | null;
  excludes: string[] | null;
  created_at: Date | null;
  last_indexed_at: Date | null;
}

interface CodeFileRow {
  path: string;
  hash: string;
}

interface IndexJobRow {
  id: string | number;
  project_id: string;
  type: string;
  status: string;
  started_at: Date;
  completed_at: Date | null;
  stats: IndexStats | null;
  error: string | null;
}

interface AdvisoryLockRow {
  locked: boolean;
}

const LOCK_KEY_SQL = `('x' || substr(md5($1::text), 1, 16))::bit(64)::bigint`;

export class PostgresCodeMetaStore implements ICodeMetaStore {
  constructor(protected readonly pool: pg.Pool) {}

  async registerProject(project: CodeProject): Promise<void> {
    await this.pool.query(
      `INSERT INTO code_projects (id, name, root_path, language, layer_config, excludes, created_at, last_indexed_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, COALESCE($7, NOW()), $8)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         root_path = EXCLUDED.root_path,
         language = EXCLUDED.language,
         layer_config = EXCLUDED.layer_config,
         excludes = EXCLUDED.excludes`,
      [
        project.id,
        project.name,
        project.root,
        project.language,
        project.layerConfig ? JSON.stringify(project.layerConfig) : null,
        project.excludes ?? null,
        project.createdAt ?? null,
        project.lastIndexedAt ?? null,
      ],
    );
  }

  async unregisterProject(projectId: string): Promise<void> {
    await this.pool.query(`DELETE FROM code_index_jobs WHERE project_id = $1`, [projectId]);
    await this.pool.query(`DELETE FROM code_projects WHERE id = $1`, [projectId]);
  }

  async listProjects(): Promise<CodeProject[]> {
    const { rows } = await this.pool.query<CodeProjectRow>(
      `SELECT id, name, root_path, language, layer_config, excludes, created_at, last_indexed_at
         FROM code_projects ORDER BY name`,
    );
    return rows.map(rowToCodeProject);
  }

  async getProjectByRoot(root: string): Promise<CodeProject | null> {
    const { rows } = await this.pool.query<CodeProjectRow>(
      `SELECT id, name, root_path, language, layer_config, excludes, created_at, last_indexed_at
         FROM code_projects WHERE root_path = $1 LIMIT 1`,
      [root],
    );
    return rows[0] ? rowToCodeProject(rows[0]) : null;
  }

  async getProjectById(projectId: string): Promise<CodeProject | null> {
    const { rows } = await this.pool.query<CodeProjectRow>(
      `SELECT id, name, root_path, language, layer_config, excludes, created_at, last_indexed_at
         FROM code_projects WHERE id = $1 LIMIT 1`,
      [projectId],
    );
    return rows[0] ? rowToCodeProject(rows[0]) : null;
  }

  async upsertFileHashes(projectId: string, hashes: CodeFileHash[]): Promise<void> {
    if (hashes.length === 0) {
      return;
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const h of hashes) {
        await client.query(
          `INSERT INTO code_files (project_id, path, hash, git_sha, indexed_at)
           VALUES ($1, $2, $3, $4, NOW())
           ON CONFLICT (project_id, path) DO UPDATE SET
             hash = EXCLUDED.hash,
             git_sha = EXCLUDED.git_sha,
             indexed_at = NOW()`,
          [projectId, h.path, h.hash, h.gitSha ?? null],
        );
      }
      await client.query(
        `UPDATE code_projects SET last_indexed_at = NOW() WHERE id = $1`,
        [projectId],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getFileHashes(projectId: string): Promise<Map<string, string>> {
    const { rows } = await this.pool.query<CodeFileRow>(
      `SELECT path, hash FROM code_files WHERE project_id = $1`,
      [projectId],
    );
    const map = new Map<string, string>();
    for (const row of rows) {
      map.set(row.path, row.hash);
    }
    return map;
  }

  async startIndexJob(projectId: string, type: IndexJobType): Promise<number> {
    const { rows } = await this.pool.query<{ id: string }>(
      `INSERT INTO code_index_jobs (project_id, type, status, started_at)
       VALUES ($1, $2, 'running', NOW()) RETURNING id`,
      [projectId, type],
    );
    return Number(rows[0]?.id ?? 0);
  }

  async completeIndexJob(jobId: number, stats: IndexStats): Promise<void> {
    await this.pool.query(
      `UPDATE code_index_jobs
         SET status = 'completed', completed_at = NOW(), stats = $2::jsonb, error = NULL
       WHERE id = $1`,
      [jobId, JSON.stringify(stats)],
    );
  }

  async failIndexJob(jobId: number, error: string): Promise<void> {
    await this.pool.query(
      `UPDATE code_index_jobs
         SET status = 'failed', completed_at = NOW(), error = $2
       WHERE id = $1`,
      [jobId, error],
    );
  }

  async getLatestJob(projectId: string): Promise<IndexJob | null> {
    const { rows } = await this.pool.query<IndexJobRow>(
      `SELECT id, project_id, type, status, started_at, completed_at, stats, error
         FROM code_index_jobs
        WHERE project_id = $1
        ORDER BY started_at DESC
        LIMIT 1`,
      [projectId],
    );
    return rows[0] ? rowToIndexJob(rows[0]) : null;
  }

  async tryAcquireLock(projectId: string): Promise<boolean> {
    const { rows } = await this.pool.query<AdvisoryLockRow>(
      `SELECT pg_try_advisory_lock(${LOCK_KEY_SQL}) AS locked`,
      [projectId],
    );
    return rows[0]?.locked === true;
  }

  async releaseLock(projectId: string): Promise<void> {
    await this.pool.query(
      `SELECT pg_advisory_unlock(${LOCK_KEY_SQL})`,
      [projectId],
    );
  }
}

function rowToCodeProject(row: CodeProjectRow): CodeProject {
  const project: CodeProject = {
    id: row.id,
    name: row.name,
    root: row.root_path,
    language: row.language as CodeProject['language'],
  };
  if (row.layer_config) {
    project.layerConfig = row.layer_config as Record<string, CodeLayer>;
  }
  if (row.excludes) {
    project.excludes = row.excludes;
  }
  if (row.created_at) {
    project.createdAt = row.created_at.toISOString();
  }
  if (row.last_indexed_at) {
    project.lastIndexedAt = row.last_indexed_at.toISOString();
  }
  return project;
}

function rowToIndexJob(row: IndexJobRow): IndexJob {
  const job: IndexJob = {
    id: Number(row.id),
    projectId: row.project_id,
    type: row.type as IndexJob['type'],
    status: row.status as IndexJob['status'],
    startedAt: row.started_at.toISOString(),
  };
  if (row.completed_at) {
    job.completedAt = row.completed_at.toISOString();
  }
  if (row.stats) {
    job.stats = row.stats;
  }
  if (row.error) {
    job.error = row.error;
  }
  return job;
}
