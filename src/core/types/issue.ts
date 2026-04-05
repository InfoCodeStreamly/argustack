/**
 * Core issue types — pure data, no dependencies.
 * These represent the canonical shape of data flowing through the system.
 * Adapters map external formats (Jira JSON, Git commits) to these types.
 */

export interface Issue {
  key: string;
  id: string;
  projectKey: string;
  summary: string;
  description: string | null;
  issueType: string | null;
  status: string | null;
  statusCategory: string | null;
  priority: string | null;
  resolution: string | null;
  assignee: string | null;
  assigneeId: string | null;
  reporter: string | null;
  reporterId: string | null;
  created: string | null;
  updated: string | null;
  resolved: string | null;
  dueDate: string | null;
  labels: string[];
  components: string[];
  fixVersions: string[];
  parentKey: string | null;
  sprint: string | null;
  storyPoints: number | null;
  originalEstimate: number | null;
  remainingEstimate: number | null;
  timeSpent: number | null;
  customFields: Record<string, unknown>;
  /** Full raw response from the source (Jira API JSON, etc.) — stored as-is */
  rawJson: Record<string, unknown>;
  /** Where this issue came from: 'jira' (synced from Jira) or 'local' (created on board) */
  source?: 'jira' | 'local';
}

export interface IssueComment {
  issueKey: string;
  commentId: string;
  author: string | null;
  body: string | null;
  created: string | null;
  updated: string | null;
}

export interface IssueChangelog {
  issueKey: string;
  author: string | null;
  field: string;
  fromValue: string | null;
  toValue: string | null;
  changedAt: string | null;
}

export interface IssueWorklog {
  issueKey: string;
  author: string | null;
  timeSpent: string | null;
  timeSpentSeconds: number | null;
  comment: string | null;
  started: string | null;
}

export interface IssueLink {
  sourceKey: string;
  targetKey: string;
  linkType: string;
  direction: 'inward' | 'outward';
}

/**
 * Complete issue bundle — issue + all related data.
 * This is what a source provider returns and what storage saves.
 */
export interface IssueBatch {
  issues: Issue[];
  comments: IssueComment[];
  changelogs: IssueChangelog[];
  worklogs: IssueWorklog[];
  links: IssueLink[];
}

export interface HybridSearchResult {
  issueKey: string;
  score: number;
  source: 'text' | 'semantic' | 'both';
}
