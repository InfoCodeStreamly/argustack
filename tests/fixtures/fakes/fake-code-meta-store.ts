import type { ICodeMetaStore } from '../../../src/core/ports/code-meta.js';
import type {
  CodeProject,
  CodeFileHash,
  IndexJob,
  IndexJobType,
  IndexStats,
} from '../../../src/core/types/code.js';

export class FakeCodeMetaStore implements ICodeMetaStore {
  readonly projects = new Map<string, CodeProject>();
  readonly fileHashes = new Map<string, Map<string, string>>();
  readonly jobs: IndexJob[] = [];
  readonly locks = new Set<string>();

  readonly registerCalls: CodeProject[] = [];
  readonly unregisterCalls: string[] = [];
  readonly upsertHashCalls: { projectId: string; count: number }[] = [];

  private nextJobId = 1;

  registerProject(project: CodeProject): Promise<void> {
    this.projects.set(project.id, project);
    this.registerCalls.push(project);
    if (!this.fileHashes.has(project.id)) {
      this.fileHashes.set(project.id, new Map());
    }
    return Promise.resolve();
  }

  unregisterProject(projectId: string): Promise<void> {
    this.unregisterCalls.push(projectId);
    this.projects.delete(projectId);
    this.fileHashes.delete(projectId);
    return Promise.resolve();
  }

  listProjects(): Promise<CodeProject[]> {
    return Promise.resolve(Array.from(this.projects.values()));
  }

  getProjectByRoot(root: string): Promise<CodeProject | null> {
    for (const p of this.projects.values()) {
      if (p.root === root) {return Promise.resolve(p);}
    }
    return Promise.resolve(null);
  }

  getProjectById(projectId: string): Promise<CodeProject | null> {
    return Promise.resolve(this.projects.get(projectId) ?? null);
  }

  upsertFileHashes(projectId: string, hashes: CodeFileHash[]): Promise<void> {
    this.upsertHashCalls.push({ projectId, count: hashes.length });
    let bucket = this.fileHashes.get(projectId);
    if (!bucket) {
      bucket = new Map();
      this.fileHashes.set(projectId, bucket);
    }
    for (const h of hashes) {
      bucket.set(h.path, h.hash);
    }
    return Promise.resolve();
  }

  getFileHashes(projectId: string): Promise<Map<string, string>> {
    const bucket = this.fileHashes.get(projectId);
    const copy: Map<string, string> = bucket ? new Map(bucket) : new Map<string, string>();
    return Promise.resolve(copy);
  }

  startIndexJob(projectId: string, type: IndexJobType): Promise<number> {
    const id = this.nextJobId++;
    this.jobs.push({
      id,
      projectId,
      type,
      status: 'running',
      startedAt: new Date().toISOString(),
    });
    return Promise.resolve(id);
  }

  completeIndexJob(jobId: number, stats: IndexStats): Promise<void> {
    const job = this.jobs.find((j) => j.id === jobId);
    if (job) {
      job.status = 'completed';
      job.completedAt = new Date().toISOString();
      job.stats = stats;
    }
    return Promise.resolve();
  }

  failIndexJob(jobId: number, error: string): Promise<void> {
    const job = this.jobs.find((j) => j.id === jobId);
    if (job) {
      job.status = 'failed';
      job.completedAt = new Date().toISOString();
      job.error = error;
    }
    return Promise.resolve();
  }

  getLatestJob(projectId: string): Promise<IndexJob | null> {
    const matched = this.jobs
      .filter((j) => j.projectId === projectId)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return Promise.resolve(matched[0] ?? null);
  }

  tryAcquireLock(projectId: string): Promise<boolean> {
    if (this.locks.has(projectId)) {return Promise.resolve(false);}
    this.locks.add(projectId);
    return Promise.resolve(true);
  }

  releaseLock(projectId: string): Promise<void> {
    this.locks.delete(projectId);
    return Promise.resolve();
  }

  clear(): void {
    this.projects.clear();
    this.fileHashes.clear();
    this.jobs.length = 0;
    this.locks.clear();
    this.registerCalls.length = 0;
    this.unregisterCalls.length = 0;
    this.upsertHashCalls.length = 0;
    this.nextJobId = 1;
  }
}
