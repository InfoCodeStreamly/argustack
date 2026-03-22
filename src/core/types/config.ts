/**
 * Workspace configuration — which sources are connected.
 * Stored in .argustack/config.json
 */

export type SourceType = 'jira' | 'git' | 'github' | 'csv' | 'db';

export interface SourceConfig {
  enabled: boolean;
  addedAt: string;       // ISO date when source was added
  disabledAt?: string;   // ISO date when source was disabled
}

export interface WorkspaceConfig {
  version: 1;
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
  db: {
    label: 'Project Database',
    description: 'Coming soon — not available yet',
  },
};

export const ALL_SOURCES: SourceType[] = ['jira', 'csv', 'git', 'github', 'db'];
