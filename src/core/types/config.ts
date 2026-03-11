/**
 * Workspace configuration — which sources are connected.
 * Stored in .argustack/config.json
 */

export type SourceType = 'jira' | 'git' | 'db';

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
    description: 'Issues, bugs, tasks — what was planned',
  },
  git: {
    label: 'Git',
    description: 'Commits, branches, PRs — what was built',
  },
  db: {
    label: 'Database',
    description: 'Tables, data — what actually exists',
  },
};

export const ALL_SOURCES: SourceType[] = ['jira', 'git', 'db'];
