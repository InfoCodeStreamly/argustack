import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export interface IssueRow {
  issue_key?: string;
  summary?: string;
  status?: string;
  priority?: string;
  assignee?: string;
  issue_type?: string;
  project_key?: string;
  created?: string;
  updated?: string;
}

export interface FullIssueRow {
  issue_key: string;
  summary: string;
  issue_type?: string;
  status?: string;
  priority?: string;
  assignee?: string;
  reporter?: string;
  created?: string;
  updated?: string;
  labels?: string[];
  components?: string[];
  parent_key?: string;
  description?: string;
  custom_fields?: Record<string, unknown>;
}

export interface CommentRow {
  author?: string;
  body?: string;
  created?: string;
}

export interface ChangelogRow {
  author?: string;
  field?: string;
  from_value?: string;
  to_value?: string;
  changed_at?: string;
}

export interface CountRow {
  count: string;
}

export interface StatusCountRow extends CountRow {
  status?: string;
}

export interface TypeCountRow extends CountRow {
  issue_type?: string;
}

export interface ProjectCountRow extends CountRow {
  project_key?: string;
}

export interface AssigneeCountRow extends CountRow {
  assignee?: string;
}

export interface CommitRow {
  hash?: string;
  message?: string;
  author?: string;
  email?: string;
  committed_at?: string;
  repo_path?: string;
}

export interface PrRow {
  number?: number;
  title?: string;
  state?: string;
  author?: string;
  created_at?: string;
  updated_at?: string;
  merged_at?: string;
  base_ref?: string;
  additions?: number;
  deletions?: number;
}

export interface TimelineEvent {
  date: string;
  type: 'created' | 'changelog' | 'commit' | 'pr_opened' | 'pr_reviewed' | 'pr_merged';
  text: string;
}

export interface EstimateSimilarRow {
  issue_key: string;
  summary: string;
  issue_type: string;
  status: string;
  assignee: string | null;
  created: string;
  resolved: string | null;
  parent_key: string | null;
  story_points: number | null;
  components: string[] | null;
  labels: string[] | null;
  original_estimate: number | null;
  time_spent: number | null;
  type_match: number;
  component_overlap: number;
  temporal_weight: string | number;
  composite_score: string | number;
  rank: string | number;
}

export interface FamiliarityRow {
  component: string;
  resolved_count: number;
  avg_time_hours: number;
  last_resolved: string;
}

export interface SimilarTaskMetrics {
  issueKey: string;
  hours: number;
  weight: number;
  isCycleFallback?: boolean;
}

export interface EstimateWorklogRow {
  issue_key: string;
  author: string;
  total_seconds: string;
}

export interface EstimateCommitRow {
  issue_key: string;
  commits: string;
  authors: string;
  total_additions: string;
  total_deletions: string;
  first_commit: string | null;
  last_commit: string | null;
}

export interface EstimateBugRow {
  bug_key: string;
  summary: string;
  resolved: string | null;
  created: string;
  bug_time_spent: number | null;
}

export interface EstimateRawRow {
  issue_key: string;
  original_estimate: string | number | null;
  time_spent: string | number | null;
}

export interface DevCoefficientRow {
  assignee: string;
  task_count: string;
  coeff_no_bugs: string;
  coeff_with_bugs: string;
  bug_ratio: string;
  context_label: string;
}

export interface ToolContent { type: 'text'; text: string }

export interface ToolResponse {
  [key: string]: unknown;
  content: ToolContent[];
  isError?: boolean;
}

export type RegisterToolsFn = (server: McpServer) => void;
