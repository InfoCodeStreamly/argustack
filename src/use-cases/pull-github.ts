import type { IGitHubProvider } from '../core/ports/github-provider.js';
import type { IStorage } from '../core/ports/storage.js';

function noop(_message: string): void {
  // intentionally empty — used as default onProgress
}

export interface PullGitHubOptions {
  since?: Date;
  onProgress?: (message: string) => void;
}

export interface PullGitHubResult {
  repoFullName: string;
  prsCount: number;
  reviewsCount: number;
  commentsCount: number;
  filesCount: number;
  issueRefsCount: number;
  releasesCount: number;
}

/**
 * Use Case: Pull PRs, reviews, releases from GitHub → save to storage.
 *
 * Same pattern as PullGitUseCase for commits.
 * Talks through IGitHubProvider and IStorage interfaces only.
 */
export class PullGitHubUseCase {
  constructor(
    private readonly github: IGitHubProvider,
    private readonly storage: IStorage,
  ) {}

  async execute(repoFullName: string, options: PullGitHubOptions = {}): Promise<PullGitHubResult> {
    const log = options.onProgress ?? noop;

    await this.storage.initialize();

    const lastPrDate = options.since ?? (await this.storage.getLastPrUpdated(repoFullName));
    const since = lastPrDate && !options.since
      ? new Date(lastPrDate.getTime() - 60_000)
      : lastPrDate ?? undefined;

    if (since) {
      log(`  Incremental pull: PRs updated since ${since.toISOString()}`);
    }

    log(`Pulling PRs from ${repoFullName}...`);

    const result: PullGitHubResult = {
      repoFullName,
      prsCount: 0,
      reviewsCount: 0,
      commentsCount: 0,
      filesCount: 0,
      issueRefsCount: 0,
      releasesCount: 0,
    };

    for await (const batch of this.github.pullPullRequests(since)) {
      await this.storage.saveGitHubBatch(batch);

      result.prsCount += batch.pullRequests.length;
      result.reviewsCount += batch.reviews.length;
      result.commentsCount += batch.comments.length;
      result.filesCount += batch.files.length;
      result.issueRefsCount += batch.issueRefs.length;

      log(`  ${result.prsCount} PRs...`);
    }

    log(`Pulling releases from ${repoFullName}...`);
    const releases = await this.github.pullReleases();
    await this.storage.saveReleases(releases);
    result.releasesCount = releases.length;

    log(`  Done: ${result.prsCount} PRs, ${result.reviewsCount} reviews, ${result.releasesCount} releases`);
    return result;
  }
}
