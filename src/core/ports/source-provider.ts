import type { Issue, IssueBatch, Project } from '../types/index.js';

/**
 * Port: Source Provider — where we pull data FROM.
 *
 * Implementations: JiraProvider, (future) GitHubProvider, GitLabProvider, etc.
 * Core doesn't know about Jira or any specific API.
 */
export interface ISourceProvider {
  /** Human-readable name of the source (e.g. "Jira", "GitHub") */
  readonly name: string;

  /** Test connection and return available projects */
  getProjects(): Promise<Project[]>;

  /**
   * Pull all issues for a project.
   * Yields batches (pages) for memory efficiency — don't load 100k issues at once.
   *
   * @param projectKey - Project identifier
   * @param since - Only issues updated after this date (incremental pull)
   */
  pullIssues(projectKey: string, since?: string): AsyncGenerator<IssueBatch>;

  /**
   * Get total issue count for progress reporting.
   * Optional — providers that don't support this simply won't show percentages.
   */
  getIssueCount?(projectKey: string, since?: string): Promise<number>;

  /** Create an issue in the source system (e.g., Jira). Returns the created issue key. */
  createIssue?(issue: Issue): Promise<string>;
}
