import type { IGitProvider } from '../core/ports/git-provider.js';
import type { IStorage } from '../core/ports/storage.js';

function noop(_message: string): void {
  // intentionally empty — used as default onProgress
}

export interface PullGitOptions {
  since?: Date;
  onProgress?: (message: string) => void;
}

export interface PullGitResult {
  repoPath: string;
  commitsCount: number;
  filesCount: number;
  issueRefsCount: number;
}

/**
 * Use Case: Pull commits from Git repository → save to storage.
 *
 * Same pattern as PullUseCase for Jira.
 * Talks through IGitProvider and IStorage interfaces only.
 */
export class PullGitUseCase {
  constructor(
    private readonly git: IGitProvider,
    private readonly storage: IStorage,
  ) {}

  async execute(repoPath: string, options: PullGitOptions = {}): Promise<PullGitResult> {
    const log = options.onProgress ?? noop;

    await this.storage.initialize();

    const lastCommitDate = options.since ?? (await this.storage.getLastCommitDate(repoPath));
    const since = lastCommitDate && !options.since
      ? new Date(lastCommitDate.getTime() - 60_000)
      : lastCommitDate ?? undefined;

    if (since) {
      log(`  Incremental pull: commits since ${since.toISOString()}`);
    }

    log(`Pulling commits from ${repoPath}...`);

    const result: PullGitResult = {
      repoPath,
      commitsCount: 0,
      filesCount: 0,
      issueRefsCount: 0,
    };

    for await (const batch of this.git.pullCommits(since)) {
      await this.storage.saveCommitBatch(batch);

      result.commitsCount += batch.commits.length;
      result.filesCount += batch.files.length;
      result.issueRefsCount += batch.issueRefs.length;

      log(`  ${result.commitsCount} commits...`);
    }

    log(`  Done: ${result.commitsCount} commits, ${result.filesCount} files, ${result.issueRefsCount} issue refs`);
    return result;
  }
}
