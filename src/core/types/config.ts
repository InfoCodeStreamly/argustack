/**
 * Workspace configuration — which sources are connected.
 * Stored in .argustack/config.json
 */

export type SourceType = 'jira' | 'git' | 'github' | 'csv' | 'db' | 'board';

export interface SourceConfig {
  enabled: boolean;
  addedAt: string;
  disabledAt?: string;
  issueTypes?: string[];
  issueTypeIds?: string[];
}

export interface WorkspaceConfig {
  version: 1;
  /** Workspace name (directory name, kebab-case) */
  name?: string;
  /** Which sources are configured */
  sources: Partial<Record<SourceType, SourceConfig>>;
  /** Order of sources (for analysis priority) */
  order: SourceType[];
  /** When workspace was created */
  createdAt: string;
}

/** Source display metadata (for CLI prompts) */
export const SOURCE_META: Record<SourceType, { label: string; description: string }> = {
  jira: {
    label: 'Jira',
    description:
      'Connects to your Jira, you pick which projects. Downloads every issue with all fields (including custom), ' +
      'every comment, worklog (time spent), changelog (who changed what field and when), links between issues. ' +
      'Stored in local PostgreSQL. Ask: who works on what, how long tasks take, what gets blocked, sprint velocity, team workload',
  },
  git: {
    label: 'Git — commits & code history',
    description:
      'Downloads COMMIT HISTORY — who wrote what code, when, which files changed, how many lines. ' +
      'Reads from a repo folder on your machine or clones from GitHub. No API token needed for local repos. ' +
      'Links commits to Jira tasks (PROJ-123 in commit message). ' +
      'This is DIFFERENT from GitHub below — Git gives you commits, GitHub gives you PRs and reviews. ' +
      'If your code is on GitHub, select BOTH Git and GitHub for full picture',
  },
  github: {
    label: 'GitHub — pull requests & reviews',
    description:
      'Downloads PR HISTORY via GitHub API — who opened PRs, who reviewed, who approved/rejected, review comments. ' +
      'Also downloads releases with tags. Requires a GitHub token (read-only). ' +
      'This is DIFFERENT from Git above — GitHub gives you PRs and reviews, Git gives you commits. ' +
      'If your code is on GitHub, select BOTH Git and GitHub for full picture',
  },
  csv: {
    label: 'Jira CSV Import (no API needed)',
    description:
      'Same data as Jira above, but from a CSV file instead of API. ' +
      'For teams without Jira API access or when you already have an export. ' +
      'Supports all standard fields, comments, worklogs, and issue links. ' +
      'Export from Jira: Filters → Export → CSV (All fields)',
  },
  board: {
    label: 'Board — local task files',
    description:
      'Syncs Markdown task files from Docs/Tasks/ into the database. ' +
      'Tasks created on the Argustack board or by AI agents get a local source marker. ' +
      'Use `argustack push` to create Jira issues from local tasks.',
  },
  db: {
    label: 'Project Database (read-only)',
    description:
      'Connects to your project database (PostgreSQL, MySQL, MSSQL, SQLite, Oracle). ' +
      'Syncs schema metadata (tables, columns, foreign keys, indexes) into Argustack for fast lookup. ' +
      'Claude can browse schema structure offline and run read-only SQL queries against the live database. ' +
      'All queries are validated — only SELECT/EXPLAIN/SHOW allowed, 30s timeout, 1000-row limit',
  },
};

export const ALL_SOURCES: SourceType[] = ['jira', 'csv', 'git', 'github', 'db', 'board'];
