import type { ISourceProvider } from '../core/ports/source-provider.js';
import type { IStorage } from '../core/ports/storage.js';

function noop(_message: string): void { /* intentional */ }

export interface PullOptions {
  /** Specific project key, or null for all configured projects */
  projectKey?: string;
  /** Pull only issues updated since this date */
  since?: string;
  /** Callback for progress reporting */
  onProgress?: (message: string) => void;
}

export interface PullResult {
  projectKey: string;
  issuesCount: number;
  commentsCount: number;
  changelogsCount: number;
  worklogsCount: number;
  linksCount: number;
}

/**
 * Use Case: Pull data from source → save to storage.
 *
 * This is pure orchestration logic.
 * It doesn't know about Jira, PostgreSQL, or CLI.
 * It only talks through ISourceProvider and IStorage interfaces.
 */
export class PullUseCase {
  constructor(
    private readonly source: ISourceProvider,
    private readonly storage: IStorage,
  ) {}

  async execute(options: PullOptions = {}): Promise<PullResult[]> {
    const log = options.onProgress ?? noop;
    const results: PullResult[] = [];

    await this.storage.initialize();

    let projectKeys: string[];
    if (options.projectKey) {
      projectKeys = [options.projectKey];
    } else {
      const projects = await this.source.getProjects();
      projectKeys = projects.map((p) => p.key);
    }

    for (const projectKey of projectKeys) {
      const lastUpdated = options.since ?? (await this.storage.getLastUpdated(projectKey));
      const since = lastUpdated && !options.since
        ? new Date(new Date(lastUpdated).getTime() - 60_000).toISOString()
        : lastUpdated;
      if (since) {
        log(`  Incremental pull: issues updated since ${since}`);
      }

      let total: number | null = null;
      try {
        total = await this.source.getIssueCount?.(projectKey, since ?? undefined) ?? null;
      } catch { /* count unavailable */ }
      log(`Pulling ${projectKey}${total !== null ? ` (${total} issues)` : ''}...`);

      const result: PullResult = {
        projectKey,
        issuesCount: 0,
        commentsCount: 0,
        changelogsCount: 0,
        worklogsCount: 0,
        linksCount: 0,
      };

      for await (const batch of this.source.pullIssues(projectKey, since ?? undefined)) {
        await this.storage.saveBatch(batch);

        result.issuesCount += batch.issues.length;
        result.commentsCount += batch.comments.length;
        result.changelogsCount += batch.changelogs.length;
        result.worklogsCount += batch.worklogs.length;
        result.linksCount += batch.links.length;

        if (total !== null && total > 0) {
          const pct = Math.min(100, Math.round(result.issuesCount / total * 100));
          log(`  ${projectKey}: ${result.issuesCount}/${total} issues (${pct}%)`);
        } else {
          log(`  ${result.issuesCount} issues...`);
        }
      }

      log(`  Done: ${result.issuesCount} issues, ${result.commentsCount} comments`);
      results.push(result);
    }

    return results;
  }
}
