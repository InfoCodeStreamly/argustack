/**
 * SSOT: All test constants, IDs, and factory functions.
 * Every test imports data from here — no hardcoded values in tests.
 */

import type {
  Issue,
  IssueComment,
  IssueChangelog,
  IssueWorklog,
  IssueLink,
  IssueBatch,
  Project,
  WorkspaceConfig,
  PullRequest,
  PullRequestReview,
  PullRequestComment,
  PullRequestFile,
  Release,
  GitHubBatch,
} from '../../../src/core/types/index.js';

// ─── IDs ──────────────────────────────────────────────────────────────

export const TEST_IDS = {
  projectKey: 'TEST',
  projectName: 'Test Project',
  projectId: '10001',

  issueKey: 'TEST-1',
  issueId: '100001',

  issueKey2: 'TEST-2',
  issueId2: '100002',

  issueKey3: 'TEST-3',
  issueId3: '100003',

  commentId: 'comment-1',
  author: 'John Doe',
  reporter: 'Jane Smith',
} as const;

// ─── Factory: Project ─────────────────────────────────────────────────

export function createProject(overrides?: Partial<Project>): Project {
  return {
    key: TEST_IDS.projectKey,
    name: TEST_IDS.projectName,
    id: TEST_IDS.projectId,
    ...overrides,
  };
}

// ─── Factory: Issue ───────────────────────────────────────────────────

export function createIssue(overrides?: Partial<Issue>): Issue {
  return {
    key: TEST_IDS.issueKey,
    id: TEST_IDS.issueId,
    projectKey: TEST_IDS.projectKey,
    summary: 'Test issue summary',
    description: 'Test issue description',
    issueType: 'Task',
    status: 'In Progress',
    statusCategory: 'In Progress',
    priority: 'Medium',
    resolution: null,
    assignee: TEST_IDS.author,
    reporter: TEST_IDS.reporter,
    created: '2025-01-15T10:00:00.000+0000',
    updated: '2025-01-16T12:00:00.000+0000',
    resolved: null,
    dueDate: null,
    labels: ['backend'],
    components: ['API'],
    fixVersions: [],
    parentKey: null,
    sprint: 'Sprint 1',
    storyPoints: 3,
    customFields: {},
    rawJson: {},
    ...overrides,
  };
}

// ─── Factory: IssueComment ────────────────────────────────────────────

export function createComment(overrides?: Partial<IssueComment>): IssueComment {
  return {
    issueKey: TEST_IDS.issueKey,
    commentId: TEST_IDS.commentId,
    author: TEST_IDS.author,
    body: 'Test comment body',
    created: '2025-01-15T11:00:00.000+0000',
    updated: '2025-01-15T11:00:00.000+0000',
    ...overrides,
  };
}

// ─── Factory: IssueChangelog ──────────────────────────────────────────

export function createChangelog(overrides?: Partial<IssueChangelog>): IssueChangelog {
  return {
    issueKey: TEST_IDS.issueKey,
    author: TEST_IDS.author,
    field: 'status',
    fromValue: 'Open',
    toValue: 'In Progress',
    changedAt: '2025-01-15T12:00:00.000+0000',
    ...overrides,
  };
}

// ─── Factory: IssueWorklog ────────────────────────────────────────────

export function createWorklog(overrides?: Partial<IssueWorklog>): IssueWorklog {
  return {
    issueKey: TEST_IDS.issueKey,
    author: TEST_IDS.author,
    timeSpent: '2h',
    timeSpentSeconds: 7200,
    comment: 'Worked on implementation',
    started: '2025-01-15T09:00:00.000+0000',
    ...overrides,
  };
}

// ─── Factory: IssueLink ───────────────────────────────────────────────

export function createLink(overrides?: Partial<IssueLink>): IssueLink {
  return {
    sourceKey: TEST_IDS.issueKey,
    targetKey: TEST_IDS.issueKey2,
    linkType: 'Blocks',
    direction: 'outward',
    ...overrides,
  };
}

// ─── Factory: IssueBatch ──────────────────────────────────────────────

export function createBatch(overrides?: Partial<IssueBatch>): IssueBatch {
  return {
    issues: [createIssue()],
    comments: [createComment()],
    changelogs: [createChangelog()],
    worklogs: [createWorklog()],
    links: [createLink()],
    ...overrides,
  };
}

export function createEmptyBatch(): IssueBatch {
  return {
    issues: [],
    comments: [],
    changelogs: [],
    worklogs: [],
    links: [],
  };
}

// ─── GitHub IDs ──────────────────────────────────────────────────────

export const GITHUB_TEST_IDS = {
  repoFullName: 'test-org/test-repo',
  prNumber: 42,
  prNumber2: 43,
  reviewId: 1001,
  commentId: 2001,
  releaseId: 3001,
} as const;

// ─── Factory: PullRequest ────────────────────────────────────────────

export function createPullRequest(overrides?: Partial<PullRequest>): PullRequest {
  return {
    number: GITHUB_TEST_IDS.prNumber,
    repoFullName: GITHUB_TEST_IDS.repoFullName,
    title: 'feat: add login page',
    body: 'Implements PAP-123 login feature',
    state: 'merged',
    author: 'johndoe',
    createdAt: '2025-01-10T10:00:00Z',
    updatedAt: '2025-01-12T14:00:00Z',
    mergedAt: '2025-01-12T14:00:00Z',
    closedAt: '2025-01-12T14:00:00Z',
    mergeCommitSha: 'abc1234567890abcdef1234567890abcdef123456',
    headRef: 'feature/login',
    baseRef: 'main',
    labels: ['feature'],
    reviewers: ['janedoe'],
    additions: 150,
    deletions: 20,
    changedFiles: 5,
    rawJson: {},
    ...overrides,
  };
}

// ─── Factory: PullRequestReview ──────────────────────────────────────

export function createPrReview(overrides?: Partial<PullRequestReview>): PullRequestReview {
  return {
    prNumber: GITHUB_TEST_IDS.prNumber,
    repoFullName: GITHUB_TEST_IDS.repoFullName,
    reviewId: GITHUB_TEST_IDS.reviewId,
    reviewer: 'janedoe',
    state: 'APPROVED',
    body: 'Looks good!',
    submittedAt: '2025-01-11T16:00:00Z',
    ...overrides,
  };
}

// ─── Factory: PullRequestComment ─────────────────────────────────────

export function createPrComment(overrides?: Partial<PullRequestComment>): PullRequestComment {
  return {
    prNumber: GITHUB_TEST_IDS.prNumber,
    repoFullName: GITHUB_TEST_IDS.repoFullName,
    commentId: GITHUB_TEST_IDS.commentId,
    author: 'janedoe',
    body: 'Nit: consider renaming this variable',
    path: 'src/login.ts',
    line: 42,
    createdAt: '2025-01-11T15:00:00Z',
    updatedAt: '2025-01-11T15:00:00Z',
    ...overrides,
  };
}

// ─── Factory: PullRequestFile ────────────────────────────────────────

export function createPrFile(overrides?: Partial<PullRequestFile>): PullRequestFile {
  return {
    prNumber: GITHUB_TEST_IDS.prNumber,
    repoFullName: GITHUB_TEST_IDS.repoFullName,
    filePath: 'src/login.ts',
    status: 'added',
    additions: 100,
    deletions: 0,
    ...overrides,
  };
}

// ─── Factory: Release ────────────────────────────────────────────────

export function createRelease(overrides?: Partial<Release>): Release {
  return {
    id: GITHUB_TEST_IDS.releaseId,
    repoFullName: GITHUB_TEST_IDS.repoFullName,
    tagName: 'v1.0.0',
    name: 'Version 1.0.0',
    body: 'First stable release',
    author: 'johndoe',
    draft: false,
    prerelease: false,
    createdAt: '2025-02-01T10:00:00Z',
    publishedAt: '2025-02-01T10:00:00Z',
    rawJson: {},
    ...overrides,
  };
}

// ─── Factory: GitHubBatch ────────────────────────────────────────────

export function createGitHubBatch(overrides?: Partial<GitHubBatch>): GitHubBatch {
  return {
    pullRequests: [createPullRequest()],
    reviews: [createPrReview()],
    comments: [createPrComment()],
    files: [createPrFile()],
    issueRefs: [{
      prNumber: GITHUB_TEST_IDS.prNumber,
      repoFullName: GITHUB_TEST_IDS.repoFullName,
      issueKey: 'PAP-123',
    }],
    ...overrides,
  };
}

export function createEmptyGitHubBatch(): GitHubBatch {
  return {
    pullRequests: [],
    reviews: [],
    comments: [],
    files: [],
    issueRefs: [],
  };
}

// ─── Factory: WorkspaceConfig ─────────────────────────────────────────

export function createWorkspaceConfig(overrides?: Partial<WorkspaceConfig>): WorkspaceConfig {
  return {
    version: 1,
    sources: {},
    order: [],
    createdAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}
