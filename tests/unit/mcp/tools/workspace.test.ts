/**
 * Unit tests for registerWorkspaceTools.
 *
 * Covers three tools: workspace_info, list_projects, pull_jira.
 * All external dependencies (helpers, SOURCE_META, PullUseCase) are mocked
 * at the module boundary.  Each handler is captured at registration time
 * and invoked directly without starting the full MCP transport.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TEST_IDS } from '../../../fixtures/shared/test-constants.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

vi.mock('../../../../src/mcp/helpers.js', () => ({
  loadWorkspace: vi.fn(),
  createAdapters: vi.fn(),
  getEnabledSources: vi.fn(() => []),
  textResponse: (text: string) => ({ content: [{ type: 'text', text }] }),
  errorResponse: (text: string) => ({ content: [{ type: 'text', text }], isError: true }),
  getErrorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
  str: (v: unknown): string => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v as string | number | boolean)),
}));

vi.mock('../../../../src/core/types/index.js', () => ({
  SOURCE_META: {
    jira: { label: 'Jira', description: 'Issue tracker' },
    git: { label: 'Git', description: 'Version control' },
    github: { label: 'GitHub', description: 'Pull requests' },
    csv: { label: 'CSV', description: 'CSV import' },
    db: { label: 'Database', description: 'Schema sync' },
  },
}));

vi.mock('../../../../src/use-cases/pull.js', () => ({
  PullUseCase: vi.fn(function (this: Record<string, unknown>) {
    this.execute = vi.fn().mockResolvedValue([
      { projectKey: TEST_IDS.projectKey, issuesCount: 10, commentsCount: 5, changelogsCount: 20, worklogsCount: 3, linksCount: 2 },
    ]);
  }),
}));

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let registerWorkspaceTools: typeof import('../../../../src/mcp/tools/workspace.js').registerWorkspaceTools;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let loadWorkspace: typeof import('../../../../src/mcp/helpers.js').loadWorkspace;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let createAdapters: typeof import('../../../../src/mcp/helpers.js').createAdapters;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let getEnabledSources: typeof import('../../../../src/mcp/helpers.js').getEnabledSources;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let PullUseCase: typeof import('../../../../src/use-cases/pull.js').PullUseCase;

type ToolHandler = (args: Record<string, unknown>) => unknown;
const registeredTools = new Map<string, ToolHandler>();

const mockServer = {
  registerTool: vi.fn((name: string, _schema: unknown, handler: ToolHandler) => {
    registeredTools.set(name, handler);
  }),
};

function getHandler(name: string): ToolHandler {
  const handler = registeredTools.get(name);
  if (!handler) {throw new Error(`Tool ${name} not registered`);}
  return handler;
}

beforeEach(async () => {
  vi.clearAllMocks();
  registeredTools.clear();

  const helpers = await import('../../../../src/mcp/helpers.js');
  loadWorkspace = helpers.loadWorkspace;
  createAdapters = helpers.createAdapters;
  getEnabledSources = helpers.getEnabledSources;

  const pullModule = await import('../../../../src/use-cases/pull.js');
  PullUseCase = pullModule.PullUseCase;

  const toolModule = await import('../../../../src/mcp/tools/workspace.js');
  registerWorkspaceTools = toolModule.registerWorkspaceTools;
  registerWorkspaceTools(mockServer as unknown as McpServer);
});

// ─── workspace_info ───────────────────────────────────────────────────────────

describe('workspace_info', () => {
  it('returns errorResponse with diagnostic when workspace is not found', () => {
    vi.mocked(loadWorkspace).mockReturnValue({ ok: false, reason: 'no .argustack/ marker found' });

    const handler = getHandler('workspace_info');
    const result = handler({}) as { content: { text: string }[]; isError?: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('No Argustack workspace found');
    expect(result.content[0].text).toContain('no .argustack/ marker found');
    expect(result.content[0].text).toContain('argustack init');
  });

  it('returns workspace root and createdAt when workspace is found with no sources', () => {
    vi.mocked(loadWorkspace).mockReturnValue({
      ok: true,
      root: '/projects/myapp',
      config: { version: 1, sources: {}, order: [], createdAt: '2025-03-01T00:00:00.000Z' },
    });
    vi.mocked(getEnabledSources).mockReturnValue([]);

    const handler = getHandler('workspace_info');
    const result = handler({}) as { content: { text: string }[] };
    const text = result.content[0].text;

    expect(text).toContain('/projects/myapp');
    expect(text).toContain('2025-03-01T00:00:00.000Z');
    expect(text).toContain('(none)');
  });

  it('lists enabled sources with their labels and descriptions', () => {
    vi.mocked(loadWorkspace).mockReturnValue({
      ok: true,
      root: '/ws',
      config: {
        version: 1,
        sources: {
          jira: { enabled: true, addedAt: '2025-01-01' },
          git: { enabled: true, addedAt: '2025-01-01' },
        },
        order: ['jira', 'git'],
        createdAt: '2025-01-01T00:00:00.000Z',
      },
    });
    vi.mocked(getEnabledSources).mockReturnValue(['jira', 'git']);

    const handler = getHandler('workspace_info');
    const result = handler({}) as { content: { text: string }[] };
    const text = result.content[0].text;

    expect(text).toContain('Jira');
    expect(text).toContain('Issue tracker');
    expect(text).toContain('Git');
    expect(text).toContain('Version control');
    expect(text).toContain('Configured sources (2)');
    expect(text).toContain('Jira → Git');
  });

  it('shows source count in the configured sources line', () => {
    vi.mocked(loadWorkspace).mockReturnValue({
      ok: true,
      root: '/ws',
      config: { version: 1, sources: {}, order: [], createdAt: '2025-01-01T00:00:00.000Z' },
    });
    vi.mocked(getEnabledSources).mockReturnValue(['github']);

    const handler = getHandler('workspace_info');
    const result = handler({}) as { content: { text: string }[] };

    expect(result.content[0].text).toContain('Configured sources (1)');
  });
});

// ─── list_projects ────────────────────────────────────────────────────────────

describe('list_projects', () => {
  it('returns errorResponse when workspace is not found', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({ ok: false, reason: 'config missing' });

    const handler = getHandler('list_projects');
    const result = await handler({}) as { content: { text: string }[]; isError?: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Workspace not found');
  });

  it('returns errorResponse when Jira source is not configured (source is null)', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({ ok: true, root: '/ws', config: { version: 1, sources: {}, order: [], createdAt: '2025-01-01' } });
    vi.mocked(createAdapters).mockResolvedValue({ storage: {} as never, source: null });

    const handler = getHandler('list_projects');
    const result = await handler({}) as { content: { text: string }[]; isError?: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Jira is not configured');
  });

  it('returns formatted project list when source.getProjects succeeds', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({ ok: true, root: '/ws', config: { version: 1, sources: {}, order: [], createdAt: '2025-01-01' } });

    const mockSource = {
      getProjects: vi.fn().mockResolvedValue([
        { key: 'ALPHA', name: 'Alpha Project' },
        { key: 'BETA', name: 'Beta Project' },
      ]),
    };
    vi.mocked(createAdapters).mockResolvedValue({ storage: {} as never, source: mockSource as never });

    const handler = getHandler('list_projects');
    const result = await handler({}) as { content: { text: string }[] };
    const text = result.content[0].text;

    expect(text).toContain('2 Jira projects');
    expect(text).toContain('ALPHA');
    expect(text).toContain('Alpha Project');
    expect(text).toContain('BETA');
    expect(text).toContain('Beta Project');
  });

  it('returns errorResponse when getProjects throws', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({ ok: true, root: '/ws', config: { version: 1, sources: {}, order: [], createdAt: '2025-01-01' } });

    const mockSource = {
      getProjects: vi.fn().mockRejectedValue(new Error('Unauthorized: invalid token')),
    };
    vi.mocked(createAdapters).mockResolvedValue({ storage: {} as never, source: mockSource as never });

    const handler = getHandler('list_projects');
    const result = await handler({}) as { content: { text: string }[]; isError?: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Unauthorized: invalid token');
  });

  it('returns result with 0 projects when Jira returns empty list', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({ ok: true, root: '/ws', config: { version: 1, sources: {}, order: [], createdAt: '2025-01-01' } });

    const mockSource = { getProjects: vi.fn().mockResolvedValue([]) };
    vi.mocked(createAdapters).mockResolvedValue({ storage: {} as never, source: mockSource as never });

    const handler = getHandler('list_projects');
    const result = await handler({}) as { content: { text: string }[] };

    expect(result.content[0].text).toContain('0 Jira projects');
  });
});

// ─── pull_jira ────────────────────────────────────────────────────────────────

describe('pull_jira', () => {
  it('returns errorResponse when workspace is not found', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({ ok: false, reason: 'no workspace' });

    const handler = getHandler('pull_jira');
    const result = await handler({}) as { content: { text: string }[]; isError?: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Workspace not found');
  });

  it('returns errorResponse when Jira source is null', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({ ok: true, root: '/ws', config: { version: 1, sources: {}, order: [], createdAt: '2025-01-01' } });

    const mockStorage = { close: vi.fn().mockResolvedValue(undefined) };
    vi.mocked(createAdapters).mockResolvedValue({ storage: mockStorage as never, source: null });

    const handler = getHandler('pull_jira');
    const result = await handler({}) as { content: { text: string }[]; isError?: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Jira is not configured');
  });

  it('returns pull summary with issue counts on successful pull', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({ ok: true, root: '/ws', config: { version: 1, sources: {}, order: [], createdAt: '2025-01-01' } });

    const mockStorage = { close: vi.fn().mockResolvedValue(undefined) };
    const mockSource = {};
    vi.mocked(createAdapters).mockResolvedValue({ storage: mockStorage as never, source: mockSource as never });

    const handler = getHandler('pull_jira');
    const result = await handler({}) as { content: { text: string }[] };
    const text = result.content[0].text;

    expect(text).toContain('Pull complete!');
    expect(text).toContain(TEST_IDS.projectKey);
    expect(text).toContain('10 issues');
    expect(text).toContain('5 comments');
    expect(text).toContain('20 changelogs');
    expect(text).toContain('3 worklogs');
    expect(text).toContain('2 links');
    expect(mockStorage.close).toHaveBeenCalled();
  });

  it('passes project filter to PullUseCase.execute when project arg is provided', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({ ok: true, root: '/ws', config: { version: 1, sources: {}, order: [], createdAt: '2025-01-01' } });

    const mockStorage = { close: vi.fn().mockResolvedValue(undefined) };
    const mockSource = {};
    vi.mocked(createAdapters).mockResolvedValue({ storage: mockStorage as never, source: mockSource as never });

    const handler = getHandler('pull_jira');
    await handler({ project: 'ALPHA' });

    const instance = vi.mocked(PullUseCase).mock.instances[0] as { execute: ReturnType<typeof vi.fn> };
    expect(instance.execute).toHaveBeenCalledWith(
      expect.objectContaining({ projectKey: 'ALPHA' }),
    );
  });

  it('passes since filter to PullUseCase.execute when since arg is provided', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({ ok: true, root: '/ws', config: { version: 1, sources: {}, order: [], createdAt: '2025-01-01' } });

    const mockStorage = { close: vi.fn().mockResolvedValue(undefined) };
    const mockSource = {};
    vi.mocked(createAdapters).mockResolvedValue({ storage: mockStorage as never, source: mockSource as never });

    const handler = getHandler('pull_jira');
    await handler({ since: '2025-01-01' });

    const instance = vi.mocked(PullUseCase).mock.instances[0] as { execute: ReturnType<typeof vi.fn> };
    expect(instance.execute).toHaveBeenCalledWith(
      expect.objectContaining({ since: '2025-01-01' }),
    );
  });

  it('returns errorResponse when PullUseCase.execute throws', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({ ok: true, root: '/ws', config: { version: 1, sources: {}, order: [], createdAt: '2025-01-01' } });

    const mockStorage = { close: vi.fn().mockResolvedValue(undefined) };
    const mockSource = {};
    vi.mocked(createAdapters).mockResolvedValue({ storage: mockStorage as never, source: mockSource as never });

    vi.mocked(PullUseCase).mockImplementation(function (this: Record<string, unknown>) {
      this.execute = vi.fn().mockRejectedValue(new Error('Jira API rate limit exceeded'));
    } as never);

    const handler = getHandler('pull_jira');
    const result = await handler({}) as { content: { text: string }[]; isError?: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Jira API rate limit exceeded');
  });

  it('does not include projectKey in execute args when project arg is omitted', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({ ok: true, root: '/ws', config: { version: 1, sources: {}, order: [], createdAt: '2025-01-01' } });

    const mockStorage = { close: vi.fn().mockResolvedValue(undefined) };
    const mockSource = {};
    vi.mocked(createAdapters).mockResolvedValue({ storage: mockStorage as never, source: mockSource as never });

    vi.mocked(PullUseCase).mockImplementation(function (this: Record<string, unknown>) {
      this.execute = vi.fn().mockResolvedValue([]);
    } as never);

    const handler = getHandler('pull_jira');
    await handler({});

    const instance = vi.mocked(PullUseCase).mock.instances[0] as { execute: ReturnType<typeof vi.fn> };
    const callArgs = instance.execute.mock.calls[0][0] as Record<string, unknown>;
    expect(callArgs).not.toHaveProperty('projectKey');
  });
});
