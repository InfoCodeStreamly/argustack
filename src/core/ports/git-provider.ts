import type { CommitBatch, GitRef } from '../types/git.js';

/**
 * Port: Git Provider — reads commits, branches, tags from a Git repository.
 *
 * Implementations: GitProvider (es-git), (future) GitHubApiProvider, etc.
 * Core doesn't know about es-git or any specific library.
 *
 * @throws Error if repository path is invalid or not a git repo
 */
export interface IGitProvider {
  /** Human-readable name (e.g. "Git (local)") */
  readonly name: string;

  /**
   * Pull commits from the repository.
   * Yields batches for memory efficiency — large repos can have 100k+ commits.
   *
   * @param since - Only commits after this date (incremental pull)
   */
  pullCommits(since?: Date): AsyncGenerator<CommitBatch>;

  /** List all branches */
  getBranches(): Promise<GitRef[]>;

  /** List all tags */
  getTags(): Promise<GitRef[]>;
}
