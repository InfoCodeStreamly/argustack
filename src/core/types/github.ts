export interface PullRequest {
  number: number;
  repoFullName: string;
  title: string;
  body: string | null;
  state: 'open' | 'closed' | 'merged';
  author: string | null;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  closedAt: string | null;
  mergeCommitSha: string | null;
  headRef: string;
  baseRef: string;
  labels: string[];
  reviewers: string[];
  additions: number;
  deletions: number;
  changedFiles: number;
  rawJson: Record<string, unknown>;
}

export interface PullRequestReview {
  prNumber: number;
  repoFullName: string;
  reviewId: number;
  reviewer: string | null;
  state: string;
  body: string | null;
  submittedAt: string | null;
}

export interface PullRequestComment {
  prNumber: number;
  repoFullName: string;
  commentId: number;
  author: string | null;
  body: string | null;
  path: string | null;
  line: number | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface PullRequestFile {
  prNumber: number;
  repoFullName: string;
  filePath: string;
  status: 'added' | 'modified' | 'removed' | 'renamed';
  additions: number;
  deletions: number;
}

export interface PullRequestIssueRef {
  prNumber: number;
  repoFullName: string;
  issueKey: string;
}

export interface Release {
  id: number;
  repoFullName: string;
  tagName: string;
  name: string | null;
  body: string | null;
  author: string | null;
  draft: boolean;
  prerelease: boolean;
  createdAt: string;
  publishedAt: string | null;
  rawJson: Record<string, unknown>;
}

export interface GitHubBatch {
  pullRequests: PullRequest[];
  reviews: PullRequestReview[];
  comments: PullRequestComment[];
  files: PullRequestFile[];
  issueRefs: PullRequestIssueRef[];
}
