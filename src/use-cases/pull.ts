import type { ISourceProvider } from '../core/ports/source-provider.js';
import type { IStorage } from '../core/ports/storage.js';

/** Intentional no-op for default progress callback */
function noop(_message: string): void {
  // intentionally empty — used as default onProgress
}

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

    // Initialize storage (create tables if needed)
    await this.storage.initialize();

    // Determine which projects to pull
    let projectKeys: string[];
    if (options.projectKey) {
      projectKeys = [options.projectKey];
    } else {
      const projects = await this.source.getProjects();
      projectKeys = projects.map((p) => p.key);
    }

    for (const projectKey of projectKeys) {
      log(`Pulling ${projectKey} from ${this.source.name}...`);

      // Determine "since" — explicit or from last pull
      // Subtract 1 minute overlap for auto-incremental to avoid missing issues
      // (Jira API has minute-level precision; UPSERT makes re-pulls harmless)
      const lastUpdated = options.since ?? (await this.storage.getLastUpdated(projectKey));
      const since = lastUpdated && !options.since
        ? new Date(new Date(lastUpdated).getTime() - 60_000).toISOString()
        : lastUpdated;
      if (since) {
        log(`  Incremental pull: issues updated since ${since}`);
      }

      const result: PullResult = {
        projectKey,
        issuesCount: 0,
        commentsCount: 0,
        changelogsCount: 0,
        worklogsCount: 0,
        linksCount: 0,
      };

      // Pull in batches (pages)
      for await (const batch of this.source.pullIssues(projectKey, since ?? undefined)) {
        await this.storage.saveBatch(batch);

        result.issuesCount += batch.issues.length;
        result.commentsCount += batch.comments.length;
        result.changelogsCount += batch.changelogs.length;
        result.worklogsCount += batch.worklogs.length;
        result.linksCount += batch.links.length;

        log(`  ${result.issuesCount} issues...`);
      }

      log(`  Done: ${result.issuesCount} issues, ${result.commentsCount} comments`);
      results.push(result);
    }

    return results;
  }
}
