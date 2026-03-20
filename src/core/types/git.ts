/**
 * Core Git types — pure data, no dependencies.
 * Adapters map external formats (es-git, simple-git) to these types.
 */

export interface Commit {
  hash: string;
  message: string;
  author: string;
  email: string;
  committedAt: string;
  parents: string[];
  repoPath: string;
}

export interface CommitFile {
  commitHash: string;
  filePath: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
}

export interface CommitIssueRef {
  commitHash: string;
  issueKey: string;
}

export interface CommitBatch {
  commits: Commit[];
  files: CommitFile[];
  issueRefs: CommitIssueRef[];
}

export interface GitRef {
  name: string;
  type: 'branch' | 'tag';
  hash: string;
}
