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
  Commit,
  CommitFile,
  CommitIssueRef,
  CommitBatch,
  PullRequest,
  PullRequestReview,
  PullRequestComment,
  PullRequestFile,
  Release,
  GitHubBatch,
  DbTable,
  DbColumn,
  DbForeignKey,
  DbIndex,
  DbSchemaBatch,
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

  projectKey2: 'OTHER',
  projectName2: 'Other Project',
  projectId2: '10002',

  alternativeIssueKey: 'ALPHA-42',
  alternativeProjectKey: 'ALPHA',
} as const;

export const ESTIMATE_TEST_IDS = {
  issueKey: 'TASK-10',
  issueKey2: 'TASK-11',
  issueKey3: 'TASK-12',
  issueKey4: 'TASK-13',
  issueKey5: 'TASK-14',
  issueKey6: 'TASK-15',
  bugKey: 'BUG-1',
  excludeKey: 'TASK-99',
  assignee: 'John',
  metricKeyPrefix: 'TASK',
} as const;

export const SEARCH_TEST_IDS = {
  ghostKey: 'GHOST-99',
  notFoundKey: 'TEST-99',
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
    assigneeId: 'test-assignee-id-001',
    reporter: TEST_IDS.reporter,
    reporterId: 'test-reporter-id-001',
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
    originalEstimate: 14400,
    remainingEstimate: 7200,
    timeSpent: 7200,
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

// ─── Git IDs ─────────────────────────────────────────────────────────

export const GIT_TEST_IDS = {
  repoPath: '/test/repo',
  repoPath2: '/test/repo2',
  commitHash: 'abc1234567890abcdef1234567890abcdef123456',
  commitHash2: 'def4567890abcdef1234567890abcdef456789ab',
  commitAuthor: 'John Doe',
  commitEmail: 'john@example.com',
  issueRefKey: 'TEST-1',
  issueRefKey2: 'TEST-2',
  issueRefKey3: 'PROJ-7',
  multiRefKey1: 'PAY-42',
  multiRefKey2: 'PAY-10',
  multiRefKey3: 'CORE-5',
  shortPrefixKey: 'AB-1',
} as const;

// ─── Factory: Commit ─────────────────────────────────────────────────

export function createCommit(overrides?: Partial<Commit>): Commit {
  return {
    hash: GIT_TEST_IDS.commitHash,
    message: `feat: implement login ${GIT_TEST_IDS.issueRefKey}`,
    author: GIT_TEST_IDS.commitAuthor,
    email: GIT_TEST_IDS.commitEmail,
    committedAt: '2025-01-15T10:00:00.000Z',
    parents: [],
    repoPath: GIT_TEST_IDS.repoPath,
    ...overrides,
  };
}

// ─── Factory: CommitFile ─────────────────────────────────────────────

export function createCommitFile(overrides?: Partial<CommitFile>): CommitFile {
  return {
    commitHash: GIT_TEST_IDS.commitHash,
    filePath: 'src/login.ts',
    status: 'added',
    additions: 50,
    deletions: 0,
    ...overrides,
  };
}

// ─── Factory: CommitIssueRef ─────────────────────────────────────────

export function createCommitIssueRef(overrides?: Partial<CommitIssueRef>): CommitIssueRef {
  return {
    commitHash: GIT_TEST_IDS.commitHash,
    issueKey: GIT_TEST_IDS.issueRefKey,
    ...overrides,
  };
}

// ─── Factory: CommitBatch ────────────────────────────────────────────

export function createCommitBatch(overrides?: Partial<CommitBatch>): CommitBatch {
  return {
    commits: [createCommit()],
    files: [createCommitFile()],
    issueRefs: [createCommitIssueRef()],
    ...overrides,
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
  prAuthor: 'johndoe',
  reviewer: 'janedoe',
  issueRefKey: 'PROJ-123',
  issueRefKey2: 'PROJ-456',
  issueRefKey3: 'PROJ-100',
} as const;

// ─── Factory: PullRequest ────────────────────────────────────────────

export function createPullRequest(overrides?: Partial<PullRequest>): PullRequest {
  return {
    number: GITHUB_TEST_IDS.prNumber,
    repoFullName: GITHUB_TEST_IDS.repoFullName,
    title: 'feat: add login page',
    body: 'Implements PROJ-123 login feature',
    state: 'merged',
    author: GITHUB_TEST_IDS.prAuthor,
    createdAt: '2025-01-10T10:00:00Z',
    updatedAt: '2025-01-12T14:00:00Z',
    mergedAt: '2025-01-12T14:00:00Z',
    closedAt: '2025-01-12T14:00:00Z',
    mergeCommitSha: 'abc1234567890abcdef1234567890abcdef123456',
    headRef: 'feature/login',
    baseRef: 'main',
    labels: ['feature'],
    reviewers: [GITHUB_TEST_IDS.reviewer],
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
    reviewer: GITHUB_TEST_IDS.reviewer,
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
    author: GITHUB_TEST_IDS.reviewer,
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
    author: GITHUB_TEST_IDS.prAuthor,
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
      issueKey: GITHUB_TEST_IDS.issueRefKey,
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

// ─── CSV Test Helpers ─────────────────────────────────────────────────

export const CSV_TEST_IDS = {
  issueKey: 'CSV-1',
  issueId: '200001',
  issueKey2: 'CSV-2',
  issueId2: '200002',
  projectKey: 'CSV',
} as const;

export function createCsvHeaders(): string[] {
  return [
    'Summary', 'Issue key', 'Issue id', 'Issue Type', 'Status',
    'Priority', 'Resolution', 'Assignee', 'Reporter',
    'Created', 'Updated', 'Resolved', 'Description',
    'Due date', 'Parent key', 'Status Category',
    'Original estimate', 'Remaining Estimate', 'Time Spent',
    'Labels', 'Labels',
    'Components', 'Components',
    'Fix versions',
    'Comment', 'Comment',
    'Log Work', 'Log Work',
    'Inward issue link (Blocks)', 'Outward issue link (Blocks)',
    'Custom field (Story Points)', 'Custom field (Team)',
  ];
}

export function createCsvRow(overrides?: Partial<Record<string, string>>): string[] {
  const defaults: Record<string, string> = {
    Summary: 'Test CSV issue',
    'Issue key': CSV_TEST_IDS.issueKey,
    'Issue id': CSV_TEST_IDS.issueId,
    'Issue Type': 'Task',
    Status: 'In Progress',
    Priority: 'Medium',
    Resolution: '',
    Assignee: TEST_IDS.author,
    Reporter: TEST_IDS.reporter,
    Created: '15/Jan/25 10:00 AM',
    Updated: '16/Jan/25 12:00 PM',
    Resolved: '',
    Description: 'Test description',
    'Due date': '',
    'Parent key': '',
    'Status Category': 'In Progress',
    'Original estimate': '14400',
    'Remaining Estimate': '7200',
    'Time Spent': '7200',
    Labels1: 'backend',
    Labels2: 'api',
    Components1: 'API',
    Components2: '',
    'Fix versions': '',
    Comment1: '15/Jan/25 11:00 AM;john.doe;First comment',
    Comment2: '',
    'Log Work1': 'Implementation;15/Jan/25 09:00 AM;john.doe;3600',
    'Log Work2': '',
    'Inward issue link (Blocks)': CSV_TEST_IDS.issueKey2,
    'Outward issue link (Blocks)': '',
    'Custom field (Story Points)': '5',
    'Custom field (Team)': 'Backend',
    ...overrides,
  };

  const headers = createCsvHeaders();
  const row: string[] = [];
  const fieldNames = [
    'Summary', 'Issue key', 'Issue id', 'Issue Type', 'Status',
    'Priority', 'Resolution', 'Assignee', 'Reporter',
    'Created', 'Updated', 'Resolved', 'Description',
    'Due date', 'Parent key', 'Status Category',
    'Original estimate', 'Remaining Estimate', 'Time Spent',
    'Labels1', 'Labels2',
    'Components1', 'Components2',
    'Fix versions',
    'Comment1', 'Comment2',
    'Log Work1', 'Log Work2',
    'Inward issue link (Blocks)', 'Outward issue link (Blocks)',
    'Custom field (Story Points)', 'Custom field (Team)',
  ];

  for (let i = 0; i < headers.length; i++) {
    row.push(defaults[fieldNames[i] ?? ''] ?? '');
  }

  return row;
}

// ─── DB IDs ──────────────────────────────────────────────────────────

export const DB_TEST_IDS = {
  sourceName: 'postgresql:localhost:5432/testdb',
  schema: 'public',
  tableName: 'users',
  tableName2: 'orders',
  columnName: 'id',
  columnName2: 'email',
  indexName: 'idx_users_email',
  fkColumn: 'user_id',
} as const;

// ─── Factory: DbTable ───────────────────────────────────────────────

export function createDbTable(overrides?: Partial<DbTable>): DbTable {
  return {
    sourceName: DB_TEST_IDS.sourceName,
    schema: DB_TEST_IDS.schema,
    name: DB_TEST_IDS.tableName,
    rowCount: 1000,
    sizeBytes: 65536,
    columns: [createDbColumn()],
    ...overrides,
  };
}

// ─── Factory: DbColumn ──────────────────────────────────────────────

export function createDbColumn(overrides?: Partial<DbColumn>): DbColumn {
  return {
    tableName: DB_TEST_IDS.tableName,
    name: DB_TEST_IDS.columnName,
    dataType: 'integer',
    nullable: false,
    defaultValue: null,
    isPrimaryKey: true,
    ordinalPosition: 1,
    ...overrides,
  };
}

// ─── Factory: DbForeignKey ──────────────────────────────────────────

export function createDbForeignKey(overrides?: Partial<DbForeignKey>): DbForeignKey {
  return {
    tableName: DB_TEST_IDS.tableName2,
    columnName: DB_TEST_IDS.fkColumn,
    referencedTable: DB_TEST_IDS.tableName,
    referencedColumn: DB_TEST_IDS.columnName,
    ...overrides,
  };
}

// ─── Factory: DbIndex ───────────────────────────────────────────────

export function createDbIndex(overrides?: Partial<DbIndex>): DbIndex {
  return {
    tableName: DB_TEST_IDS.tableName,
    indexName: DB_TEST_IDS.indexName,
    columns: [DB_TEST_IDS.columnName2],
    isUnique: true,
    isPrimary: false,
    ...overrides,
  };
}

// ─── Factory: DbSchemaBatch ────────────────────────────────────────

export function createDbSchemaBatch(overrides?: Partial<DbSchemaBatch>): DbSchemaBatch {
  return {
    tables: [createDbTable()],
    foreignKeys: [createDbForeignKey()],
    indexes: [createDbIndex()],
    ...overrides,
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

export const TEST_MIRROR_CONFIG = {
  excludedDirs: new Set([
    'board/src',
    'board/dictionaries',
  ]),
  excludedFiles: new Set([
    'index.ts',
  ]),
  excludedPatterns: [
    /\.d\.ts$/,
  ],
} as const;
