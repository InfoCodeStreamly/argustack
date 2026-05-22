import type { IGitHubProvider } from '../../../src/core/ports/github-provider.js';
import type { GitHubBatch, Release } from '../../../src/core/types/github.js';

export class FakeGitHubProvider implements IGitHubProvider {
  readonly name = 'FakeGitHub';

  private _batches: GitHubBatch[] = [];
  private _releases: Release[] = [];
  readonly pullCalls: { since?: Date }[] = [];

  async *pullPullRequests(since?: Date): AsyncGenerator<GitHubBatch> {
    this.pullCalls.push(since !== undefined ? { since } : {});
    await Promise.resolve();
    for (const batch of this._batches) {
      yield batch;
    }
  }

  async pullReleases(): Promise<Release[]> {
    return Promise.resolve(this._releases);
  }

  seedBatches(batches: GitHubBatch[]): void {
    this._batches = [...batches];
  }

  seedReleases(releases: Release[]): void {
    this._releases = [...releases];
  }

  async getPrCount(_since?: Date): Promise<number> {
    const total = this._batches.reduce((sum, b) => sum + b.pullRequests.length, 0);
    return Promise.resolve(total);
  }

  clear(): void {
    this._batches = [];
    this._releases = [];
    this.pullCalls.length = 0;
  }
}
