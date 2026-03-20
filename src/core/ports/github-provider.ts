import type { GitHubBatch } from '../types/github.js';
import type { Release } from '../types/github.js';

/**
 * Port: GitHub Provider — pulls PRs, reviews, and releases from a GitHub repository.
 *
 * Implementations: GitHubProvider (Octokit).
 * Core doesn't know about Octokit or any specific library.
 *
 * @throws Error if authentication fails or repository is not accessible
 */
export interface IGitHubProvider {
  readonly name: string;

  /**
   * Pull pull requests with reviews, comments, files, and issue refs.
   * Yields batches for memory efficiency.
   *
   * @param since - Only PRs updated after this date (incremental pull)
   */
  pullPullRequests(since?: Date): AsyncGenerator<GitHubBatch>;

  /**
   * Pull releases from the repository.
   */
  pullReleases(): Promise<Release[]>;
}
