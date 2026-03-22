/**
 * Fake ISourceProvider — in-memory implementation.
 * Used in unit/integration tests instead of Jira API.
 */

import type { ISourceProvider } from '../../../src/core/ports/source-provider.js';
import type { IssueBatch, Project } from '../../../src/core/types/index.js';

export class FakeSourceProvider implements ISourceProvider {
  readonly name = 'FakeSource';

  private _projects: Project[] = [];

  private readonly _batches = new Map<string, IssueBatch[]>();

  readonly pullCalls: { projectKey: string; since?: string }[] = [];

  // eslint-disable-next-line @typescript-eslint/require-await -- fake: sync impl of async interface
  async getProjects(): Promise<Project[]> {
    return this._projects;
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- fake: async generator impl
  async *pullIssues(projectKey: string, since?: string): AsyncGenerator<IssueBatch> {
    this.pullCalls.push({ projectKey, since });

    const projectBatches = this._batches.get(projectKey) ?? [];
    for (const batch of projectBatches) {
      yield batch;
    }
  }

  seedProjects(projects: Project[]): void {
    this._projects = [...projects];
  }

  seedBatches(projectKey: string, batches: IssueBatch[]): void {
    this._batches.set(projectKey, batches);
  }

  getIssueCount(projectKey: string, _since?: string): Promise<number> {
    const total = this._batches.get(projectKey)?.reduce((sum, b) => sum + b.issues.length, 0) ?? 0;
    return Promise.resolve(total);
  }

  clear(): void {
    this._projects = [];
    this._batches.clear();
    this.pullCalls.length = 0;
  }
}
