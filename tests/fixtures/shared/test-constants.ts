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
