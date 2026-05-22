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

  async registerProject(project: CodeProject): Promise<void> {
    this.projects.set(project.id, project);
    this.registerCalls.push(project);
    if (!this.fileHashes.has(project.id)) {
      this.fileHashes.set(project.id, new Map());
    }
    return Promise.resolve();
  }

  async unregisterProject(projectId: string): Promise<void> {
    this.unregisterCalls.push(projectId);
    this.projects.delete(projectId);
    this.fileHashes.delete(projectId);
    return Promise.resolve();
  }

  async listProjects(): Promise<CodeProject[]> {
    return Promise.resolve(Array.from(this.projects.values()));
  }

  async getProjectByRoot(root: string): Promise<CodeProject | null> {
    for (const p of this.projects.values()) {
      if (p.root === root) {return Promise.resolve(p);}
    }
    return Promise.resolve(null);
  }

  async getProjectById(projectId: string): Promise<CodeProject | null> {
    return Promise.resolve(this.projects.get(projectId) ?? null);
  }

  async upsertFileHashes(projectId: string, hashes: CodeFileHash[]): Promise<void> {
    this.upsertHashCalls.push({ projectId, count: hashes.length });
    let bucket = this.fileHashes.get(projectId);
    if (bucket === undefined) {
      bucket = new Map();
      this.fileHashes.set(projectId, bucket);
    }
    for (const h of hashes) {
      bucket.set(h.path, h.hash);
    }
    return Promise.resolve();
  }

  async getFileHashes(projectId: string): Promise<Map<string, string>> {
    const bucket = this.fileHashes.get(projectId);
    const copy: Map<string, string> = bucket !== undefined ? new Map(bucket) : new Map<string, string>();
    return Promise.resolve(copy);
  }

  async startIndexJob(projectId: string, type: IndexJobType): Promise<number> {
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

  async completeIndexJob(jobId: number, stats: IndexStats): Promise<void> {
    const job = this.jobs.find((j) => j.id === jobId);
    if (job !== undefined) {
      job.status = 'completed';
      job.completedAt = new Date().toISOString();
      job.stats = stats;
    }
    return Promise.resolve();
  }

  async failIndexJob(jobId: number, error: string): Promise<void> {
    const job = this.jobs.find((j) => j.id === jobId);
    if (job !== undefined) {
      job.status = 'failed';
      job.completedAt = new Date().toISOString();
      job.error = error;
    }
    return Promise.resolve();
  }

  async getLatestJob(projectId: string): Promise<IndexJob | null> {
    const matched = this.jobs
      .filter((j) => j.projectId === projectId)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return Promise.resolve(matched[0] ?? null);
  }

  async tryAcquireLock(projectId: string): Promise<boolean> {
    if (this.locks.has(projectId)) {return Promise.resolve(false);}
    this.locks.add(projectId);
    return Promise.resolve(true);
  }

  async releaseLock(projectId: string): Promise<void> {
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
