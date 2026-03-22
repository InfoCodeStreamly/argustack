/**
 * Unit tests for MCP query tools.
 *
 * Covers registerQueryTools, which registers four tools on the McpServer:
 * query_issues, query_commits, query_prs, and query_releases.
 *
 * The helpers module is mocked at the module boundary so that:
 *   - loadWorkspace controls the workspace-found / not-found path
 *   - createAdapters injects a mock storage with a controllable query()
 *
 * Each tool handler is captured via a mock McpServer and exercised in
 * isolation without touching PostgreSQL or the filesystem.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TEST_IDS, GIT_TEST_IDS, GITHUB_TEST_IDS } from '../../../fixtures/shared/test-constants.js';
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
let registerQueryTools: typeof import('../../../../src/mcp/tools/query.js').registerQueryTools;
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

  vi.mocked(loadWorkspace).mockReturnValue({ ok: true, root: '/workspace', config: {} as never });
  vi.mocked(createAdapters).mockResolvedValue({
    storage: mockStorage as never,
    source: null,
  });

  const toolModule = await import('../../../../src/mcp/tools/query.js');
  registerQueryTools = toolModule.registerQueryTools;
});

// ─── query_issues ──────────────────────────────────────────────────────────

describe('query_issues', () => {
  it('registers the query_issues tool on the server', () => {
    registerQueryTools(mockServer as unknown as McpServer);

    expect(registeredTools.has('query_issues')).toBe(true);
  });

  it('returns errorResponse when workspace is not found', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({ ok: false, reason: 'no .argustack/ found' });
    registerQueryTools(mockServer as unknown as McpServer);
    const handler = getHandler('query_issues');

    const result = await handler({}) as { content: { text: string }[]; isError?: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('no .argustack/ found');
  });

  it('returns no-results message when query returns empty rows', async () => {
    mockStorage.query.mockResolvedValue({ rows: [] });
    registerQueryTools(mockServer as unknown as McpServer);
    const handler = getHandler('query_issues');

    const result = await handler({}) as { content: { text: string }[] };

    expect(result.content[0].text).toContain('No issues found');
  });

  it('formats issue rows with key, status, summary, and assignee', async () => {
    mockStorage.query.mockResolvedValue({
      rows: [
        { issue_key: TEST_IDS.issueKey, status: 'In Progress', summary: 'Fix login bug', assignee: TEST_IDS.author },
      ],
    });
    registerQueryTools(mockServer as unknown as McpServer);
    const handler = getHandler('query_issues');

    const result = await handler({}) as { content: { text: string }[] };
    const text = result.content[0].text;

    expect(text).toContain(TEST_IDS.issueKey);
    expect(text).toContain('In Progress');
    expect(text).toContain('Fix login bug');
    expect(text).toContain(TEST_IDS.author);
  });

  it('falls back to JSON for rows without issue_key', async () => {
    mockStorage.query.mockResolvedValue({
      rows: [{ count: '5' }],
    });
    registerQueryTools(mockServer as unknown as McpServer);
    const handler = getHandler('query_issues');

    const result = await handler({}) as { content: { text: string }[] };

    expect(result.content[0].text).toContain('"count"');
  });

  it('shows unassigned when assignee is null', async () => {
    mockStorage.query.mockResolvedValue({
      rows: [
        { issue_key: TEST_IDS.issueKey2, status: 'Open', summary: 'Unowned task', assignee: null },
      ],
    });
    registerQueryTools(mockServer as unknown as McpServer);
    const handler = getHandler('query_issues');

    const result = await handler({}) as { content: { text: string }[] };

    expect(result.content[0].text).toContain('unassigned');
  });

  it('passes search param to storage query as tsquery condition', async () => {
    mockStorage.query.mockResolvedValue({ rows: [] });
    registerQueryTools(mockServer as unknown as McpServer);
    const handler = getHandler('query_issues');

    await handler({ search: 'payment bug' });

    const [sqlQuery, params] = mockStorage.query.mock.calls[0] as [string, unknown[]];
    expect(sqlQuery).toContain('plainto_tsquery');
    expect(params).toContain('payment bug');
  });

  it('passes project param as WHERE condition with uppercased value', async () => {
    mockStorage.query.mockResolvedValue({ rows: [] });
    registerQueryTools(mockServer as unknown as McpServer);
    const handler = getHandler('query_issues');

    await handler({ project: 'proj' });

    const [sqlQuery, params] = mockStorage.query.mock.calls[0] as [string, unknown[]];
    expect(sqlQuery).toContain('project_key');
    expect(params).toContain('PROJ');
  });

  it('uses raw SQL directly when sql param is provided', async () => {
    const rawSql = 'SELECT * FROM issues WHERE status = \'Done\'';
    mockStorage.query.mockResolvedValue({ rows: [] });
    registerQueryTools(mockServer as unknown as McpServer);
    const handler = getHandler('query_issues');

    await handler({ sql: rawSql });

    const [sqlQuery] = mockStorage.query.mock.calls[0] as [string, unknown[]];
    expect(sqlQuery).toBe(rawSql);
  });

  it('returns errorResponse when storage.query throws', async () => {
    mockStorage.query.mockRejectedValue(new Error('DB connection lost'));
    registerQueryTools(mockServer as unknown as McpServer);
    const handler = getHandler('query_issues');

    const result = await handler({}) as { content: { text: string }[]; isError?: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('DB connection lost');
  });

  it('calls storage.close after a successful query', async () => {
    mockStorage.query.mockResolvedValue({ rows: [] });
    registerQueryTools(mockServer as unknown as McpServer);
    const handler = getHandler('query_issues');

    await handler({});

    expect(mockStorage.close).toHaveBeenCalledOnce();
  });
});

// ─── query_commits ─────────────────────────────────────────────────────────

describe('query_commits', () => {
  it('registers the query_commits tool on the server', () => {
    registerQueryTools(mockServer as unknown as McpServer);

    expect(registeredTools.has('query_commits')).toBe(true);
  });

  it('returns no-results message when query returns empty rows', async () => {
    mockStorage.query.mockResolvedValue({ rows: [] });
    registerQueryTools(mockServer as unknown as McpServer);
    const handler = getHandler('query_commits');

    const result = await handler({}) as { content: { text: string }[] };

    expect(result.content[0].text).toContain('No commits found');
  });

  it('formats commit rows with shortHash, date, author, and message', async () => {
    mockStorage.query.mockResolvedValue({
      rows: [
        {
          hash: GIT_TEST_IDS.commitHash,
          committed_at: '2025-01-15T10:00:00.000Z',
          author: GIT_TEST_IDS.commitAuthor,
          message: 'feat: add login\ndetailed body',
        },
      ],
    });
    registerQueryTools(mockServer as unknown as McpServer);
    const handler = getHandler('query_commits');

    const result = await handler({}) as { content: { text: string }[] };
    const text = result.content[0].text;

    expect(text).toContain(GIT_TEST_IDS.commitHash.slice(0, 7));
    expect(text).toContain('2025-01-15');
    expect(text).toContain(GIT_TEST_IDS.commitAuthor);
    expect(text).toContain('feat: add login');
    expect(text).not.toContain('detailed body');
  });

  it('falls back to JSON for rows without hash', async () => {
    mockStorage.query.mockResolvedValue({
      rows: [{ count: '3' }],
    });
    registerQueryTools(mockServer as unknown as McpServer);
    const handler = getHandler('query_commits');

    const result = await handler({}) as { content: { text: string }[] };

    expect(result.content[0].text).toContain('"count"');
  });

  it('adds ILIKE condition when author filter is provided', async () => {
    mockStorage.query.mockResolvedValue({ rows: [] });
    registerQueryTools(mockServer as unknown as McpServer);
    const handler = getHandler('query_commits');

    await handler({ author: 'alice' });

    const [sqlQuery, params] = mockStorage.query.mock.calls[0] as [string, unknown[]];
    expect(sqlQuery).toContain('ILIKE');
    expect(params).toContain('%alice%');
  });

  it('JOINs commit_files table when file_path filter is provided', async () => {
    mockStorage.query.mockResolvedValue({ rows: [] });
    registerQueryTools(mockServer as unknown as McpServer);
    const handler = getHandler('query_commits');

    await handler({ file_path: 'src/auth/login.ts' });

    const [sqlQuery, params] = mockStorage.query.mock.calls[0] as [string, unknown[]];
    expect(sqlQuery).toContain('commit_files');
    expect(params).toContain('%src/auth/login.ts%');
  });

  it('adds committed_at upper bound condition when until filter is provided', async () => {
    mockStorage.query.mockResolvedValue({ rows: [] });
    registerQueryTools(mockServer as unknown as McpServer);
    const handler = getHandler('query_commits');

    await handler({ until: '2025-12-31' });

    const [sqlQuery, params] = mockStorage.query.mock.calls[0] as [string, unknown[]];
    expect(sqlQuery).toContain('committed_at <=');
    expect(params).toContain('2025-12-31');
  });

  it('adds repo_path ILIKE condition when repo_path filter is provided', async () => {
    mockStorage.query.mockResolvedValue({ rows: [] });
    registerQueryTools(mockServer as unknown as McpServer);
    const handler = getHandler('query_commits');

    await handler({ repo_path: GIT_TEST_IDS.repoPath });

    const [sqlQuery, params] = mockStorage.query.mock.calls[0] as [string, unknown[]];
    expect(sqlQuery).toContain('repo_path ILIKE');
    expect(params).toContain(`%${GIT_TEST_IDS.repoPath}%`);
  });

  it('uses raw SQL directly when sql param is provided', async () => {
    const rawSql = 'SELECT hash FROM commits WHERE author = \'bot\'';
    mockStorage.query.mockResolvedValue({ rows: [] });
    registerQueryTools(mockServer as unknown as McpServer);
    const handler = getHandler('query_commits');

    await handler({ sql: rawSql });

    const [sqlQuery] = mockStorage.query.mock.calls[0] as [string, unknown[]];
    expect(sqlQuery).toBe(rawSql);
  });

  it('returns errorResponse when storage.query throws', async () => {
    mockStorage.query.mockRejectedValue(new Error('timeout'));
    registerQueryTools(mockServer as unknown as McpServer);
    const handler = getHandler('query_commits');

    const result = await handler({}) as { content: { text: string }[]; isError?: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('timeout');
  });

  it('calls storage.close after a successful query', async () => {
    mockStorage.query.mockResolvedValue({ rows: [] });
    registerQueryTools(mockServer as unknown as McpServer);
    const handler = getHandler('query_commits');

    await handler({});

    expect(mockStorage.close).toHaveBeenCalledOnce();
  });
});

// ─── query_prs ─────────────────────────────────────────────────────────────

describe('query_prs', () => {
  it('registers the query_prs tool on the server', () => {
    registerQueryTools(mockServer as unknown as McpServer);

    expect(registeredTools.has('query_prs')).toBe(true);
  });

  it('returns no-results message when query returns empty rows', async () => {
    mockStorage.query.mockResolvedValue({ rows: [] });
    registerQueryTools(mockServer as unknown as McpServer);
    const handler = getHandler('query_prs');

    const result = await handler({}) as { content: { text: string }[] };

    expect(result.content[0].text).toContain('No pull requests found');
  });

  it('formats PR rows with number, state, title, and author', async () => {
    mockStorage.query.mockResolvedValue({
      rows: [
        {
          number: GITHUB_TEST_IDS.prNumber,
          state: 'merged',
          title: 'feat: add login page',
          author: GITHUB_TEST_IDS.prAuthor,
          merged_at: '2025-01-12T14:00:00Z',
          updated_at: '2025-01-12T14:00:00Z',
          additions: 150,
          deletions: 20,
        },
      ],
    });
    registerQueryTools(mockServer as unknown as McpServer);
    const handler = getHandler('query_prs');

    const result = await handler({}) as { content: { text: string }[] };
    const text = result.content[0].text;

    expect(text).toContain(`#${GITHUB_TEST_IDS.prNumber}`);
    expect(text).toContain('merged');
    expect(text).toContain('feat: add login page');
    expect(text).toContain(GITHUB_TEST_IDS.prAuthor);
  });

  it('falls back to JSON for rows without number', async () => {
    mockStorage.query.mockResolvedValue({
      rows: [{ title: 'orphan row' }],
    });
    registerQueryTools(mockServer as unknown as McpServer);
    const handler = getHandler('query_prs');

    const result = await handler({}) as { content: { text: string }[] };

    expect(result.content[0].text).toContain('"title"');
  });

  it('adds search_vector tsquery condition when search filter is provided for PRs', async () => {
    mockStorage.query.mockResolvedValue({ rows: [] });
    registerQueryTools(mockServer as unknown as McpServer);
    const handler = getHandler('query_prs');

    await handler({ search: 'auth refactor' });

    const [sqlQuery, params] = mockStorage.query.mock.calls[0] as [string, unknown[]];
    expect(sqlQuery).toContain('plainto_tsquery');
    expect(params).toContain('auth refactor');
  });

  it('adds state condition with lowercased value when state filter is provided', async () => {
    mockStorage.query.mockResolvedValue({ rows: [] });
    registerQueryTools(mockServer as unknown as McpServer);
    const handler = getHandler('query_prs');

    await handler({ state: 'OPEN' });

    const [sqlQuery, params] = mockStorage.query.mock.calls[0] as [string, unknown[]];
    expect(sqlQuery).toContain('state');
    expect(params).toContain('open');
  });

  it('adds updated_at condition when since filter is provided', async () => {
    mockStorage.query.mockResolvedValue({ rows: [] });
    registerQueryTools(mockServer as unknown as McpServer);
    const handler = getHandler('query_prs');

    await handler({ since: '2025-01-01' });

    const [sqlQuery, params] = mockStorage.query.mock.calls[0] as [string, unknown[]];
    expect(sqlQuery).toContain('updated_at');
    expect(params).toContain('2025-01-01');
  });

  it('uses raw SQL directly when sql param is provided', async () => {
    const rawSql = 'SELECT number FROM pull_requests LIMIT 5';
    mockStorage.query.mockResolvedValue({ rows: [] });
    registerQueryTools(mockServer as unknown as McpServer);
    const handler = getHandler('query_prs');

    await handler({ sql: rawSql });

    const [sqlQuery] = mockStorage.query.mock.calls[0] as [string, unknown[]];
    expect(sqlQuery).toBe(rawSql);
  });

  it('returns errorResponse when storage.query throws', async () => {
    mockStorage.query.mockRejectedValue(new Error('relation does not exist'));
    registerQueryTools(mockServer as unknown as McpServer);
    const handler = getHandler('query_prs');

    const result = await handler({}) as { content: { text: string }[]; isError?: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('relation does not exist');
  });

  it('calls storage.close after a successful query', async () => {
    mockStorage.query.mockResolvedValue({ rows: [] });
    registerQueryTools(mockServer as unknown as McpServer);
    const handler = getHandler('query_prs');

    await handler({});

    expect(mockStorage.close).toHaveBeenCalledOnce();
  });

  it('uses merged_at date in formatted line when PR is merged', async () => {
    mockStorage.query.mockResolvedValue({
      rows: [
        {
          number: 7,
          state: 'merged',
          title: 'chore: cleanup',
          author: 'dev',
          merged_at: '2025-03-10T08:00:00Z',
          updated_at: '2025-03-10T09:00:00Z',
          additions: 5,
          deletions: 2,
        },
      ],
    });
    registerQueryTools(mockServer as unknown as McpServer);
    const handler = getHandler('query_prs');

    const result = await handler({}) as { content: { text: string }[] };

    expect(result.content[0].text).toContain('2025-03-10');
  });

  it('adds ILIKE condition when author filter is provided for PRs', async () => {
    mockStorage.query.mockResolvedValue({ rows: [] });
    registerQueryTools(mockServer as unknown as McpServer);
    const handler = getHandler('query_prs');

    await handler({ author: GITHUB_TEST_IDS.prAuthor });

    const [sqlQuery, params] = mockStorage.query.mock.calls[0] as [string, unknown[]];
    expect(sqlQuery).toContain('author ILIKE');
    expect(params).toContain(`%${GITHUB_TEST_IDS.prAuthor}%`);
  });

  it('adds base_ref condition when base_ref filter is provided', async () => {
    mockStorage.query.mockResolvedValue({ rows: [] });
    registerQueryTools(mockServer as unknown as McpServer);
    const handler = getHandler('query_prs');

    await handler({ base_ref: 'main' });

    const [sqlQuery, params] = mockStorage.query.mock.calls[0] as [string, unknown[]];
    expect(sqlQuery).toContain('base_ref');
    expect(params).toContain('main');
  });

  it('returns errorResponse when workspace is not found for query_prs', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({ ok: false, reason: 'no .argustack/ found' });
    registerQueryTools(mockServer as unknown as McpServer);
    const handler = getHandler('query_prs');

    const result = await handler({}) as { content: { text: string }[]; isError?: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('no .argustack/ found');
  });
});

// ─── query_releases ────────────────────────────────────────────────────────

describe('query_releases', () => {
  it('registers the query_releases tool on the server', () => {
    registerQueryTools(mockServer as unknown as McpServer);

    expect(registeredTools.has('query_releases')).toBe(true);
  });

  it('returns no-results message when query returns empty rows', async () => {
    mockStorage.query.mockResolvedValue({ rows: [] });
    registerQueryTools(mockServer as unknown as McpServer);
    const handler = getHandler('query_releases');

    const result = await handler({}) as { content: { text: string }[] };

    expect(result.content[0].text).toContain('No releases found');
  });

  it('formats release rows with tag, name, author, and date', async () => {
    mockStorage.query.mockResolvedValue({
      rows: [
        {
          tag_name: 'v1.0.0',
          name: 'Version 1.0.0',
          author: GITHUB_TEST_IDS.prAuthor,
          published_at: '2025-02-01T10:00:00Z',
          draft: false,
          prerelease: false,
        },
      ],
    });
    registerQueryTools(mockServer as unknown as McpServer);
    const handler = getHandler('query_releases');

    const result = await handler({}) as { content: { text: string }[] };
    const text = result.content[0].text;

    expect(text).toContain('v1.0.0');
    expect(text).toContain('Version 1.0.0');
    expect(text).toContain(GITHUB_TEST_IDS.prAuthor);
    expect(text).toContain('2025-02-01');
  });

  it('appends draft flag to formatted line when release is a draft', async () => {
    mockStorage.query.mockResolvedValue({
      rows: [
        {
          tag_name: 'v2.0.0-rc',
          name: 'Release Candidate',
          author: 'dev',
          published_at: '2025-03-01T00:00:00Z',
          draft: true,
          prerelease: false,
        },
      ],
    });
    registerQueryTools(mockServer as unknown as McpServer);
    const handler = getHandler('query_releases');

    const result = await handler({}) as { content: { text: string }[] };

    expect(result.content[0].text).toContain('draft');
  });

  it('appends pre flag to formatted line when release is a prerelease', async () => {
    mockStorage.query.mockResolvedValue({
      rows: [
        {
          tag_name: 'v1.1.0-beta',
          name: 'Beta',
          author: 'dev',
          published_at: '2025-02-15T00:00:00Z',
          draft: false,
          prerelease: true,
        },
      ],
    });
    registerQueryTools(mockServer as unknown as McpServer);
    const handler = getHandler('query_releases');

    const result = await handler({}) as { content: { text: string }[] };

    expect(result.content[0].text).toContain('pre');
  });

  it('uses (no name) placeholder when release name is empty', async () => {
    mockStorage.query.mockResolvedValue({
      rows: [
        {
          tag_name: 'v0.9.0',
          name: '',
          author: 'bot',
          published_at: '2025-01-01T00:00:00Z',
          draft: false,
          prerelease: false,
        },
      ],
    });
    registerQueryTools(mockServer as unknown as McpServer);
    const handler = getHandler('query_releases');

    const result = await handler({}) as { content: { text: string }[] };

    expect(result.content[0].text).toContain('(no name)');
  });

  it('adds WHERE search_vector condition when search param is provided', async () => {
    mockStorage.query.mockResolvedValue({ rows: [] });
    registerQueryTools(mockServer as unknown as McpServer);
    const handler = getHandler('query_releases');

    await handler({ search: 'hotfix' });

    const [sqlQuery, params] = mockStorage.query.mock.calls[0] as [string, unknown[]];
    expect(sqlQuery).toContain('search_vector');
    expect(params).toContain('hotfix');
  });

  it('queries without WHERE clause when search param is absent', async () => {
    mockStorage.query.mockResolvedValue({ rows: [] });
    registerQueryTools(mockServer as unknown as McpServer);
    const handler = getHandler('query_releases');

    await handler({});

    const [sqlQuery] = mockStorage.query.mock.calls[0] as [string, unknown[]];
    expect(sqlQuery).not.toContain('WHERE');
  });

  it('returns errorResponse when storage.query throws', async () => {
    mockStorage.query.mockRejectedValue(new Error('syntax error'));
    registerQueryTools(mockServer as unknown as McpServer);
    const handler = getHandler('query_releases');

    const result = await handler({}) as { content: { text: string }[]; isError?: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('syntax error');
  });

  it('calls storage.close after a successful query', async () => {
    mockStorage.query.mockResolvedValue({ rows: [] });
    registerQueryTools(mockServer as unknown as McpServer);
    const handler = getHandler('query_releases');

    await handler({});

    expect(mockStorage.close).toHaveBeenCalledOnce();
  });

  it('returns errorResponse when workspace is not found for query_releases', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({ ok: false, reason: 'no .argustack/ found' });
    registerQueryTools(mockServer as unknown as McpServer);
    const handler = getHandler('query_releases');

    const result = await handler({}) as { content: { text: string }[]; isError?: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('no .argustack/ found');
  });
});
