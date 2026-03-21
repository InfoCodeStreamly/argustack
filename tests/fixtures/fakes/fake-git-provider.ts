import type { IGitProvider } from '../../../src/core/ports/git-provider.js';
import type { CommitBatch, GitRef } from '../../../src/core/types/git.js';

export class FakeGitProvider implements IGitProvider {
  readonly name = 'FakeGit';

  private _batches: CommitBatch[] = [];
  readonly pullCalls: { since?: Date }[] = [];

  // eslint-disable-next-line @typescript-eslint/require-await -- fake: async generator impl
  async *pullCommits(since?: Date): AsyncGenerator<CommitBatch> {
    this.pullCalls.push({ since });
    for (const batch of this._batches) {
      yield batch;
    }
  }

  getCommitCount(_since?: Date): Promise<number> {
    const total = this._batches.reduce((sum, b) => sum + b.commits.length, 0);
    return Promise.resolve(total);
  }

  getBranches(): Promise<GitRef[]> {
    return Promise.resolve([]);
  }

  getTags(): Promise<GitRef[]> {
    return Promise.resolve([]);
  }

  seedBatches(batches: CommitBatch[]): void {
    this._batches = [...batches];
  }

  clear(): void {
    this._batches = [];
    this.pullCalls.length = 0;
  }
}
