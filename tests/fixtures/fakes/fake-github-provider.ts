import type { IGitHubProvider } from '../../../src/core/ports/github-provider.js';
import type { GitHubBatch, Release } from '../../../src/core/types/github.js';

export class FakeGitHubProvider implements IGitHubProvider {
  readonly name = 'FakeGitHub';

  private _batches: GitHubBatch[] = [];
  private _releases: Release[] = [];
  readonly pullCalls: { since?: Date }[] = [];

  pullPullRequests(since?: Date): AsyncGenerator<GitHubBatch> {
    this.pullCalls.push({ since });
    const batches = this._batches;
    let i = 0;
    const gen: AsyncGenerator<GitHubBatch> = {
      next: () =>
        i < batches.length
          ? Promise.resolve({ value: batches[i++], done: false } as IteratorResult<GitHubBatch>)
          : Promise.resolve({ value: undefined, done: true } as IteratorResult<GitHubBatch>),
      return: () =>
        Promise.resolve({ value: undefined, done: true } as IteratorResult<GitHubBatch>),
      throw: (e: unknown) => Promise.reject(e instanceof Error ? e : new Error(String(e))),
      [Symbol.asyncIterator]() { return gen; },
    };
    return gen;
  }

  pullReleases(): Promise<Release[]> {
    return Promise.resolve(this._releases);
  }

  seedBatches(batches: GitHubBatch[]): void {
    this._batches = [...batches];
  }

  seedReleases(releases: Release[]): void {
    this._releases = [...releases];
  }

  clear(): void {
    this._batches = [];
    this._releases = [];
    this.pullCalls.length = 0;
  }
}
