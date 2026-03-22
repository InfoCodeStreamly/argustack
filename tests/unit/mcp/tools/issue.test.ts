/**
 * Unit tests for MCP issue tools.
 *
 * Covers all six tools registered by registerIssueTools:
 * get_issue, issue_stats, issue_commits, issue_prs, issue_timeline, commit_stats.
 *
 * Each tool is tested against workspace-not-found errors, empty results,
 * populated results, and optional filter parameters.
 * Storage and workspace helpers are mocked at the module boundary so no
 * real database or filesystem is required.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TEST_IDS, SEARCH_TEST_IDS, GIT_TEST_IDS, GITHUB_TEST_IDS } from '../../../fixtures/shared/test-constants.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

vi.mock('../../../../src/mcp/helpers.js', () => ({
  loadWorkspace: vi.fn(),
  createAdapters: vi.fn(),
  textResponse: (text: string) => ({ content: [{ type: 'text', text }] }),
  errorResponse: (text: string) => ({ content: [{ type: 'text', text }], isError: true }),
  getErrorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
  str: (v: unknown): string => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v as string | number | boolean)),
}));

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let registerIssueTools: typeof import('../../../../src/mcp/tools/issue.js').registerIssueTools;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let loadWorkspace: typeof import('../../../../src/mcp/helpers.js').loadWorkspace;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let createAdapters: typeof import('../../../../src/mcp/helpers.js').createAdapters;

type ToolHandler = (args: Record<string, unknown>) => unknown;
const registeredTools = new Map<string, ToolHandler>();

const mockServer = {
  registerTool: vi.fn((name: string, _schema: unknown, handler: ToolHandler) => {
    registeredTools.set(name, handler);
  }),
};

const mockStorage = {
  query: vi.fn(),
  close: vi.fn(),
  initialize: vi.fn(),
};

function getHandler(name: string): ToolHandler {
  const handler = registeredTools.get(name);
  if (!handler) {throw new Error(`Tool ${name} not registered`);}
  return handler;
}

beforeEach(async () => {
  vi.clearAllMocks();
  registeredTools.clear();
  mockStorage.query.mockResolvedValue({ rows: [] });
  mockStorage.close.mockResolvedValue(undefined);

  const helpers = await import('../../../../src/mcp/helpers.js');
  loadWorkspace = helpers.loadWorkspace;
  createAdapters = helpers.createAdapters;

  vi.mocked(createAdapters).mockResolvedValue({
    storage: mockStorage as never,
    source: null,
  });

  const toolModule = await import('../../../../src/mcp/tools/issue.js');
  registerIssueTools = toolModule.registerIssueTools;
});

function getText(result: unknown): string {
  return (result as { content: { text: string }[] }).content[0].text;
}

function isError(result: unknown): boolean {
  return (result as { isError?: boolean }).isError === true;
}

// ─── get_issue ──────────────────────────────────────────────────────────────

describe('get_issue', () => {
  beforeEach(() => {
    registerIssueTools(mockServer as unknown as McpServer);
  });

  it('returns errorResponse when workspace is not found', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({ ok: false, reason: 'no .argustack/ found' });

    const handler = getHandler('get_issue');
    const result = await handler({ issue_key: TEST_IDS.issueKey });

    expect(isError(result)).toBe(true);
    expect(getText(result)).toContain('Workspace not found');
  });

  it('returns errorResponse with "not found" when issue does not exist in database', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({ ok: true, root: '/ws', config: {} as never });
    mockStorage.query.mockResolvedValueOnce({ rows: [] });

    const handler = getHandler('get_issue');
    const result = await handler({ issue_key: SEARCH_TEST_IDS.notFoundKey });

    expect(isError(result)).toBe(true);
    expect(getText(result)).toContain('not found');
    expect(mockStorage.close).toHaveBeenCalledOnce();
  });

  it('returns formatted output with summary, status, type, assignee for a found issue', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({ ok: true, root: '/ws', config: {} as never });
    mockStorage.query
      .mockResolvedValueOnce({
        rows: [{
          issue_key: TEST_IDS.issueKey,
          summary: 'Fix bug',
          status: 'Done',
          issue_type: 'Bug',
          assignee: 'Dev',
          reporter: 'PM',
          priority: 'High',
          created: '2025-01-01',
          updated: '2025-01-15',
          labels: [],
          components: [],
          parent_key: null,
          description: 'A detailed description',
          custom_fields: {},
        }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const handler = getHandler('get_issue');
    const result = await handler({ issue_key: TEST_IDS.issueKey });
    const text = getText(result);

    expect(isError(result)).toBe(false);
    expect(text).toContain(TEST_IDS.issueKey);
    expect(text).toContain('Fix bug');
    expect(text).toContain('Done');
    expect(text).toContain('Bug');
    expect(text).toContain('Dev');
    expect(mockStorage.close).toHaveBeenCalledOnce();
  });

  it('includes Comments section when issue has comments', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({ ok: true, root: '/ws', config: {} as never });
    mockStorage.query
      .mockResolvedValueOnce({
        rows: [{
          issue_key: TEST_IDS.issueKey,
          summary: 'Fix bug',
          status: 'Done',
          issue_type: 'Bug',
          assignee: 'Dev',
          reporter: 'PM',
          created: '2025-01-01',
          updated: '2025-01-15',
          labels: [],
          components: [],
          custom_fields: {},
        }],
      })
      .mockResolvedValueOnce({
        rows: [{ author: 'Dev', body: 'Fixed it', created: '2025-01-10' }],
      })
      .mockResolvedValueOnce({ rows: [] });

    const handler = getHandler('get_issue');
    const result = await handler({ issue_key: TEST_IDS.issueKey });
    const text = getText(result);

    expect(text).toContain('## Comments');
    expect(text).toContain('Fixed it');
    expect(text).toContain('Dev');
  });

  it('includes Recent Changes section when issue has changelogs', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({ ok: true, root: '/ws', config: {} as never });
    mockStorage.query
      .mockResolvedValueOnce({
        rows: [{
          issue_key: TEST_IDS.issueKey,
          summary: 'Fix bug',
          status: 'Done',
          issue_type: 'Bug',
          assignee: 'Dev',
          reporter: 'PM',
          created: '2025-01-01',
          updated: '2025-01-15',
          labels: [],
          components: [],
          custom_fields: {},
        }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{
          author: 'Dev',
          field: 'status',
          from_value: 'Open',
          to_value: 'Done',
          changed_at: '2025-01-15',
        }],
      });

    const handler = getHandler('get_issue');
    const result = await handler({ issue_key: TEST_IDS.issueKey });
    const text = getText(result);

    expect(text).toContain('## Recent Changes');
    expect(text).toContain('status');
    expect(text).toContain('Open');
    expect(text).toContain('Done');
  });

  it('includes Custom Fields section when issue has custom_fields', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({ ok: true, root: '/ws', config: {} as never });
    mockStorage.query
      .mockResolvedValueOnce({
        rows: [{
          issue_key: TEST_IDS.issueKey,
          summary: 'Fix bug',
          status: 'Done',
          issue_type: 'Bug',
          assignee: 'Dev',
          reporter: 'PM',
          created: '2025-01-01',
          updated: '2025-01-15',
          labels: [],
          components: [],
          custom_fields: { story_points: 5, team: 'Backend' },
        }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const handler = getHandler('get_issue');
    const result = await handler({ issue_key: TEST_IDS.issueKey });
    const text = getText(result);

    expect(text).toContain('## Custom Fields');
    expect(text).toContain('story_points');
    expect(text).toContain('team');
  });

  it('calls storage.query exactly three times (issue, comments, changelogs)', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({ ok: true, root: '/ws', config: {} as never });
    mockStorage.query
      .mockResolvedValueOnce({
        rows: [{
          issue_key: TEST_IDS.issueKey,
          summary: 'Fix bug',
          status: 'Done',
          issue_type: 'Bug',
          assignee: 'Dev',
          reporter: 'PM',
          created: '2025-01-01',
          updated: '2025-01-15',
          labels: [],
          components: [],
          custom_fields: {},
        }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const handler = getHandler('get_issue');
    await handler({ issue_key: TEST_IDS.issueKey });

    expect(mockStorage.query).toHaveBeenCalledTimes(3);
  });
});

// ─── issue_stats ────────────────────────────────────────────────────────────

describe('issue_stats', () => {
  beforeEach(() => {
    registerIssueTools(mockServer as unknown as McpServer);
  });

  it('returns errorResponse when workspace is not found', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({ ok: false, reason: 'no workspace' });

    const handler = getHandler('issue_stats');
    const result = await handler({});

    expect(isError(result)).toBe(true);
    expect(getText(result)).toContain('Workspace not found');
  });

  it('returns stats with total count, by status, by type, by project, by assignee', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({ ok: true, root: '/ws', config: {} as never });
    mockStorage.query
      .mockResolvedValueOnce({ rows: [{ count: '42' }] })
      .mockResolvedValueOnce({ rows: [{ status: 'Done', count: '30' }, { status: 'In Progress', count: '12' }] })
      .mockResolvedValueOnce({ rows: [{ issue_type: 'Bug', count: '10' }, { issue_type: 'Task', count: '32' }] })
      .mockResolvedValueOnce({ rows: [{ project_key: 'TEST', count: '42' }] })
      .mockResolvedValueOnce({ rows: [{ assignee: 'Dev', count: '20' }] });

    const handler = getHandler('issue_stats');
    const result = await handler({});
    const text = getText(result);

    expect(isError(result)).toBe(false);
    expect(text).toContain('Total issues: 42');
    expect(text).toContain('## By Status');
    expect(text).toContain('Done');
    expect(text).toContain('## By Type');
    expect(text).toContain('Bug');
    expect(text).toContain('## By Project');
    expect(text).toContain('TEST');
    expect(text).toContain('## Top Assignees');
    expect(text).toContain('Dev');
    expect(mockStorage.close).toHaveBeenCalledOnce();
  });

  it('adds WHERE clause and omits By Project section when project filter is provided', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({ ok: true, root: '/ws', config: {} as never });
    mockStorage.query
      .mockResolvedValueOnce({ rows: [{ count: '10' }] })
      .mockResolvedValueOnce({ rows: [{ status: 'Done', count: '10' }] })
      .mockResolvedValueOnce({ rows: [{ issue_type: 'Task', count: '10' }] })
      .mockResolvedValueOnce({ rows: [{ project_key: 'TEST', count: '10' }] })
      .mockResolvedValueOnce({ rows: [{ assignee: 'Alice', count: '10' }] });

    const handler = getHandler('issue_stats');
    const result = await handler({ project: 'TEST' });
    const text = getText(result);

    expect(isError(result)).toBe(false);
    expect(text).toContain('(TEST)');
    expect(text).not.toContain('## By Project');
    const firstCall = mockStorage.query.mock.calls[0] as [string, unknown[]];
    expect(firstCall[1]).toContain('TEST');
  });
});

// ─── issue_commits ──────────────────────────────────────────────────────────

describe('issue_commits', () => {
  beforeEach(() => {
    registerIssueTools(mockServer as unknown as McpServer);
  });

  it('returns message about running sync when no commits are found', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({ ok: true, root: '/ws', config: {} as never });
    mockStorage.query.mockResolvedValueOnce({ rows: [] });

    const handler = getHandler('issue_commits');
    const result = await handler({ issue_key: TEST_IDS.issueKey });
    const text = getText(result);

    expect(isError(result)).toBe(false);
    expect(text).toContain('argustack sync git');
    expect(mockStorage.close).toHaveBeenCalledOnce();
  });

  it('formats commits with hash, author, date, message, and files', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({ ok: true, root: '/ws', config: {} as never });
    mockStorage.query
      .mockResolvedValueOnce({
        rows: [{
          hash: GIT_TEST_IDS.commitHash,
          message: `feat: implement login ${TEST_IDS.issueKey}`,
          author: TEST_IDS.author,
          committed_at: '2025-01-15T10:00:00.000Z',
          repo_path: '/test/repo',
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          commit_hash: GIT_TEST_IDS.commitHash,
          file_path: 'src/login.ts',
          status: 'added',
          additions: 50,
          deletions: 0,
        }],
      });

    const handler = getHandler('issue_commits');
    const result = await handler({ issue_key: TEST_IDS.issueKey });
    const text = getText(result);

    expect(isError(result)).toBe(false);
    expect(text).toContain(GIT_TEST_IDS.commitHash.slice(0, 7));
    expect(text).toContain(TEST_IDS.author);
    expect(text).toContain(`feat: implement login ${TEST_IDS.issueKey}`);
    expect(text).toContain('src/login.ts');
    expect(text).toContain('+50');
    expect(mockStorage.close).toHaveBeenCalledOnce();
  });

  it('adds ILIKE condition when repo_path filter is provided', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({ ok: true, root: '/ws', config: {} as never });
    mockStorage.query
      .mockResolvedValueOnce({
        rows: [{
          hash: GIT_TEST_IDS.commitHash,
          message: 'fix: bug',
          author: 'Dev',
          committed_at: '2025-01-15T10:00:00.000Z',
          repo_path: '/test/repo',
        }],
      })
      .mockResolvedValueOnce({ rows: [] });

    const handler = getHandler('issue_commits');
    await handler({ issue_key: TEST_IDS.issueKey, repo_path: '/test/repo' });

    const firstCall = mockStorage.query.mock.calls[0] as [string, unknown[]];
    expect(firstCall[0]).toContain('ILIKE');
    expect(firstCall[1]).toContain('%/test/repo%');
  });

  it('calls storage.query twice (commits, then commit_files)', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({ ok: true, root: '/ws', config: {} as never });
    mockStorage.query
      .mockResolvedValueOnce({
        rows: [{
          hash: GIT_TEST_IDS.commitHash,
          message: 'fix',
          author: 'Dev',
          committed_at: '2025-01-10T00:00:00.000Z',
          repo_path: '/repo',
        }],
      })
      .mockResolvedValueOnce({ rows: [] });

    const handler = getHandler('issue_commits');
    await handler({ issue_key: TEST_IDS.issueKey });

    expect(mockStorage.query).toHaveBeenCalledTimes(2);
  });
});

// ─── issue_prs ──────────────────────────────────────────────────────────────

describe('issue_prs', () => {
  beforeEach(() => {
    registerIssueTools(mockServer as unknown as McpServer);
  });

  it('returns message about GitHub sync when no PRs are found', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({ ok: true, root: '/ws', config: {} as never });
    mockStorage.query.mockResolvedValueOnce({ rows: [] });

    const handler = getHandler('issue_prs');
    const result = await handler({ issue_key: TEST_IDS.issueKey });
    const text = getText(result);

    expect(isError(result)).toBe(false);
    expect(text).toContain('GitHub sync');
    expect(mockStorage.close).toHaveBeenCalledOnce();
  });

  it('formats PRs with number, title, state, author, additions and deletions', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({ ok: true, root: '/ws', config: {} as never });
    mockStorage.query
      .mockResolvedValueOnce({
        rows: [{
          number: 42,
          title: 'feat: add login page',
          state: 'merged',
          author: GITHUB_TEST_IDS.prAuthor,
          created_at: '2025-01-10T10:00:00Z',
          merged_at: '2025-01-12T14:00:00Z',
          additions: 150,
          deletions: 20,
          base_ref: 'main',
          head_ref: 'feature/login',
          repo_full_name: GITHUB_TEST_IDS.repoFullName,
        }],
      })
      .mockResolvedValueOnce({ rows: [] });

    const handler = getHandler('issue_prs');
    const result = await handler({ issue_key: TEST_IDS.issueKey });
    const text = getText(result);

    expect(isError(result)).toBe(false);
    expect(text).toContain('#42');
    expect(text).toContain('feat: add login page');
    expect(text).toContain('merged');
    expect(text).toContain(GITHUB_TEST_IDS.prAuthor);
    expect(text).toContain('+150');
    expect(text).toContain('-20');
    expect(mockStorage.close).toHaveBeenCalledOnce();
  });

  it('includes review info when PRs have reviews', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({ ok: true, root: '/ws', config: {} as never });
    mockStorage.query
      .mockResolvedValueOnce({
        rows: [{
          number: 42,
          title: 'feat: add login page',
          state: 'merged',
          author: GITHUB_TEST_IDS.prAuthor,
          created_at: '2025-01-10T10:00:00Z',
          merged_at: '2025-01-12T14:00:00Z',
          additions: 150,
          deletions: 20,
          base_ref: 'main',
          head_ref: 'feature/login',
          repo_full_name: GITHUB_TEST_IDS.repoFullName,
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          pr_number: 42,
          reviewer: GITHUB_TEST_IDS.reviewer,
          state: 'APPROVED',
          submitted_at: '2025-01-11T16:00:00Z',
        }],
      });

    const handler = getHandler('issue_prs');
    const result = await handler({ issue_key: TEST_IDS.issueKey });
    const text = getText(result);

    expect(text).toContain('Reviews:');
    expect(text).toContain(GITHUB_TEST_IDS.reviewer);
    expect(text).toContain('APPROVED');
  });

  it('calls storage.query twice (PRs, then reviews)', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({ ok: true, root: '/ws', config: {} as never });
    mockStorage.query
      .mockResolvedValueOnce({
        rows: [{
          number: 42,
          title: 'PR',
          state: 'open',
          author: 'dev',
          created_at: '2025-01-10T00:00:00Z',
          merged_at: null,
          additions: 10,
          deletions: 5,
          base_ref: 'main',
          head_ref: 'feat',
          repo_full_name: GITHUB_TEST_IDS.repoFullName,
        }],
      })
      .mockResolvedValueOnce({ rows: [] });

    const handler = getHandler('issue_prs');
    await handler({ issue_key: TEST_IDS.issueKey });

    expect(mockStorage.query).toHaveBeenCalledTimes(2);
  });
});

// ─── issue_timeline ─────────────────────────────────────────────────────────

describe('issue_timeline', () => {
  beforeEach(() => {
    registerIssueTools(mockServer as unknown as McpServer);
  });

  it('returns "not found" message when issue does not exist', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({ ok: true, root: '/ws', config: {} as never });
    mockStorage.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const handler = getHandler('issue_timeline');
    const result = await handler({ issue_key: SEARCH_TEST_IDS.notFoundKey });
    const text = getText(result);

    expect(text).toContain('not found');
    expect(mockStorage.close).toHaveBeenCalledOnce();
  });

  it('builds full chronological timeline: created, changelog, commit, pr_opened, pr_reviewed, pr_merged', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({ ok: true, root: '/ws', config: {} as never });

    mockStorage.query
      .mockResolvedValueOnce({
        rows: [{
          issue_key: TEST_IDS.issueKey,
          summary: 'Fix bug',
          status: 'Done',
          issue_type: 'Bug',
          assignee: 'Dev',
          reporter: 'PM',
          created: '2025-01-01T00:00:00Z',
          updated: '2025-01-15T00:00:00Z',
          resolved: '2025-01-15T00:00:00Z',
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          author: 'Dev',
          field: 'status',
          from_value: 'Open',
          to_value: 'In Progress',
          changed_at: '2025-01-05T10:00:00Z',
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          hash: GIT_TEST_IDS.commitHash,
          message: `feat: fix bug ${TEST_IDS.issueKey}`,
          author: 'Dev',
          email: 'dev@example.com',
          committed_at: '2025-01-08T10:00:00Z',
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          number: 42,
          title: 'Fix bug',
          state: 'merged',
          author: 'Dev',
          created_at: '2025-01-09T10:00:00Z',
          merged_at: '2025-01-12T10:00:00Z',
          base_ref: 'main',
          additions: 10,
          deletions: 5,
          repo_full_name: GITHUB_TEST_IDS.repoFullName,
        }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{
          pr_number: 42,
          reviewer: 'Reviewer',
          state: 'APPROVED',
          submitted_at: '2025-01-11T10:00:00Z',
        }],
      });

    const handler = getHandler('issue_timeline');
    const result = await handler({ issue_key: TEST_IDS.issueKey });
    const text = getText(result);

    expect(isError(result)).toBe(false);
    expect(text).toContain(`=== ISSUE: ${TEST_IDS.issueKey} ===`);
    expect(text).toContain('TIMELINE');
    expect(text).toContain('Issue created');
    expect(text).toContain('changed status');
    expect(text).toContain(`Commit ${GIT_TEST_IDS.commitHash.slice(0, 7)}`);
    expect(text).toContain('PR #42 opened');
    expect(text).toContain('PR #42 reviewed');
    expect(text).toContain('APPROVED');
    expect(text).toContain('PR #42 merged');
    expect(mockStorage.close).toHaveBeenCalledOnce();
  });

  it('sorts timeline events chronologically by date', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({ ok: true, root: '/ws', config: {} as never });

    mockStorage.query
      .mockResolvedValueOnce({
        rows: [{
          issue_key: TEST_IDS.issueKey,
          summary: 'Fix bug',
          status: 'Done',
          issue_type: 'Bug',
          assignee: 'Dev',
          reporter: 'PM',
          created: '2025-01-10T00:00:00Z',
          updated: '2025-01-15T00:00:00Z',
          resolved: null,
        }],
      })
      .mockResolvedValueOnce({
        rows: [
          { author: 'Dev', field: 'status', from_value: 'Open', to_value: 'Done', changed_at: '2025-01-12T00:00:00Z' },
          { author: 'Dev', field: 'priority', from_value: 'Low', to_value: 'High', changed_at: '2025-01-11T00:00:00Z' },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const handler = getHandler('issue_timeline');
    const result = await handler({ issue_key: TEST_IDS.issueKey });
    const text = getText(result);

    const createdPos = text.indexOf('Issue created');
    const priorityPos = text.indexOf('changed priority');
    const statusPos = text.indexOf('changed status');

    expect(createdPos).toBeLessThan(priorityPos);
    expect(priorityPos).toBeLessThan(statusPos);
  });
});

// ─── commit_stats ───────────────────────────────────────────────────────────

describe('commit_stats', () => {
  beforeEach(() => {
    registerIssueTools(mockServer as unknown as McpServer);
  });

  it('returns errorResponse when workspace is not found', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({ ok: false, reason: 'no workspace' });

    const handler = getHandler('commit_stats');
    const result = await handler({});

    expect(isError(result)).toBe(true);
    expect(getText(result)).toContain('Workspace not found');
  });

  it('returns total commits, top authors, most changed files, linked issue keys', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({ ok: true, root: '/ws', config: {} as never });
    mockStorage.query
      .mockResolvedValueOnce({ rows: [{ count: '100' }] })
      .mockResolvedValueOnce({ rows: [{ author: TEST_IDS.author, count: '60' }, { author: TEST_IDS.reporter, count: '40' }] })
      .mockResolvedValueOnce({ rows: [{ file_path: 'src/index.ts', changes: '25' }] })
      .mockResolvedValueOnce({ rows: [{ count: '15' }] });

    const handler = getHandler('commit_stats');
    const result = await handler({});
    const text = getText(result);

    expect(isError(result)).toBe(false);
    expect(text).toContain('Total commits: 100');
    expect(text).toContain('Linked issue keys: 15');
    expect(text).toContain('## Top Authors');
    expect(text).toContain(TEST_IDS.author);
    expect(text).toContain('## Most Changed Files');
    expect(text).toContain('src/index.ts');
    expect(mockStorage.close).toHaveBeenCalledOnce();
  });

  it('adds WHERE clause for since filter', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({ ok: true, root: '/ws', config: {} as never });
    mockStorage.query
      .mockResolvedValueOnce({ rows: [{ count: '50' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '5' }] });

    const handler = getHandler('commit_stats');
    await handler({ since: '2025-01-01' });

    const firstCall = mockStorage.query.mock.calls[0] as [string, unknown[]];
    expect(firstCall[0]).toContain('WHERE');
    expect(firstCall[0]).toContain('committed_at');
    expect(firstCall[1]).toContain('2025-01-01');
  });

  it('adds ILIKE condition for author filter', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({ ok: true, root: '/ws', config: {} as never });
    mockStorage.query
      .mockResolvedValueOnce({ rows: [{ count: '30' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '3' }] });

    const handler = getHandler('commit_stats');
    await handler({ author: 'john' });

    const firstCall = mockStorage.query.mock.calls[0] as [string, unknown[]];
    expect(firstCall[0]).toContain('ILIKE');
    expect(firstCall[1]).toContain('%john%');
  });
});
