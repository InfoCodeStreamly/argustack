import type {
  CodeProject,
  CodeFileHash,
  IndexJob,
  IndexJobType,
  IndexStats,
} from '../types/code.js';

/**
 * Port: Code Metadata Store — projects registry, file hashes, index jobs.
 *
 * Backed by the existing Argustack Postgres instance (new `code_*` tables).
 * Deliberately split from `IStorage` (issue-side) to avoid bloating that port.
 *
 * Used by indexer for idempotency (hash compare), job logging, and
 * advisory locks to prevent concurrent watch + manual index.
 *
 * Tenant invariant: `projectId === workspaceId`. The code-intel data
 * model is 1:1 with workspaces; there is no separate "project" identity.
 * Enforced by FK `code_projects.workspace_id REFERENCES workspaces(id)`.
 *
 * @throws Error when the database is unreachable.
 */
export interface ICodeMetaStore {
  registerProject(project: CodeProject): Promise<void>;

  unregisterProject(projectId: string): Promise<void>;

  listProjects(): Promise<CodeProject[]>;

  getProjectByRoot(root: string): Promise<CodeProject | null>;

  getProjectById(projectId: string): Promise<CodeProject | null>;

  upsertFileHashes(projectId: string, hashes: CodeFileHash[]): Promise<void>;

  getFileHashes(projectId: string): Promise<Map<string, string>>;

  startIndexJob(projectId: string, type: IndexJobType): Promise<number>;

  completeIndexJob(jobId: number, stats: IndexStats): Promise<void>;

  failIndexJob(jobId: number, error: string): Promise<void>;

  getLatestJob(projectId: string): Promise<IndexJob | null>;

  /**
   * Acquire a session-scoped Postgres advisory lock for the project.
   * Returns true on success, false when another process holds it.
   * Caller MUST call `releaseLock` in a finally block.
   */
  tryAcquireLock(projectId: string): Promise<boolean>;

  releaseLock(projectId: string): Promise<void>;
}
