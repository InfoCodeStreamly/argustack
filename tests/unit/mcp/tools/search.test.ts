/**
 * Unit tests for registerSearchTools.
 *
 * Covers the semantic_search tool: workspace not found, missing OPENAI_API_KEY,
 * no results, and results found with formatted output.
 * All external dependencies (helpers, OpenAIEmbeddingProvider) are mocked
 * at the module boundary.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TEST_IDS, SEARCH_TEST_IDS } from '../../../fixtures/shared/test-constants.js';
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

vi.mock('../../../../src/adapters/openai/index.js', () => {
  const OpenAIEmbeddingProvider = vi.fn(function (this: Record<string, unknown>) {
    this.embed = vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]);
  });
  return { OpenAIEmbeddingProvider };
});

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let registerSearchTools: typeof import('../../../../src/mcp/tools/search.js').registerSearchTools;
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

function getHandler(name: string): ToolHandler {
  const handler = registeredTools.get(name);
  if (!handler) {throw new Error(`Tool ${name} not registered`);}
  return handler;
}

beforeEach(async () => {
  vi.clearAllMocks();
  registeredTools.clear();
  process.env['OPENAI_API_KEY'] = 'sk-test';

  const helpers = await import('../../../../src/mcp/helpers.js');
  loadWorkspace = helpers.loadWorkspace;
  createAdapters = helpers.createAdapters;

  const toolModule = await import('../../../../src/mcp/tools/search.js');
  registerSearchTools = toolModule.registerSearchTools;
  registerSearchTools(mockServer as unknown as McpServer);
});

// ─── semantic_search ──────────────────────────────────────────────────────────

describe('semantic_search', () => {
  it('returns errorResponse when workspace is not found', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({ ok: false, reason: 'no .argustack directory' });

    const handler = getHandler('semantic_search');
    const result = await handler({ query: 'login timeout' }) as { content: { text: string }[]; isError?: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Workspace not found');
  });

  it('returns errorResponse when OPENAI_API_KEY is not set', async () => {
    delete process.env['OPENAI_API_KEY'];
    vi.mocked(loadWorkspace).mockReturnValue({ ok: true, root: '/ws', config: { version: 1, sources: {}, order: [], createdAt: '2025-01-01' } });

    const mockStorage = { close: vi.fn().mockResolvedValue(undefined) };
    vi.mocked(createAdapters).mockResolvedValue({ storage: mockStorage as never, source: null });

    const handler = getHandler('semantic_search');
    const result = await handler({ query: 'timeout error' }) as { content: { text: string }[]; isError?: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('OPENAI_API_KEY');
    expect(mockStorage.close).toHaveBeenCalled();
  });

  it('returns "No similar issues found" when semanticSearch returns empty results', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({ ok: true, root: '/ws', config: { version: 1, sources: {}, order: [], createdAt: '2025-01-01' } });

    const mockStorage = {
      close: vi.fn().mockResolvedValue(undefined),
      semanticSearch: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(createAdapters).mockResolvedValue({ storage: mockStorage as never, source: null });

    const handler = getHandler('semantic_search');
    const result = await handler({ query: 'payment gateway crash' }) as { content: { text: string }[] };

    expect(result.content[0].text).toContain('No similar issues found');
    expect(mockStorage.close).toHaveBeenCalled();
  });

  it('returns formatted results with issue_key, status, summary, and similarity when results are found', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({ ok: true, root: '/ws', config: { version: 1, sources: {}, order: [], createdAt: '2025-01-01' } });

    const mockStorage = {
      close: vi.fn().mockResolvedValue(undefined),
      semanticSearch: vi.fn().mockResolvedValue([
        { issueKey: TEST_IDS.issueKey, similarity: 0.95 },
        { issueKey: TEST_IDS.issueKey2, similarity: 0.72 },
      ]),
      query: vi.fn().mockResolvedValue({
        rows: [
          { issue_key: TEST_IDS.issueKey, summary: 'Login session timeout after 5 min', status: 'Open' },
          { issue_key: TEST_IDS.issueKey2, summary: 'Auth token expiry not handled', status: 'In Progress' },
        ],
      }),
    };
    vi.mocked(createAdapters).mockResolvedValue({ storage: mockStorage as never, source: null });

    const handler = getHandler('semantic_search');
    const result = await handler({ query: 'authentication timeout' }) as { content: { text: string }[] };
    const text = result.content[0].text;

    expect(text).toContain('authentication timeout');
    expect(text).toContain('2 results');
    expect(text).toContain(TEST_IDS.issueKey);
    expect(text).toContain('[Open]');
    expect(text).toContain('Login session timeout after 5 min');
    expect(text).toContain('95.0% match');
    expect(text).toContain(TEST_IDS.issueKey2);
    expect(text).toContain('[In Progress]');
    expect(text).toContain('72.0% match');
    expect(mockStorage.close).toHaveBeenCalled();
  });

  it('formats result without issue details when issue is not found in storage query', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({ ok: true, root: '/ws', config: { version: 1, sources: {}, order: [], createdAt: '2025-01-01' } });

    const mockStorage = {
      close: vi.fn().mockResolvedValue(undefined),
      semanticSearch: vi.fn().mockResolvedValue([
        { issueKey: SEARCH_TEST_IDS.ghostKey, similarity: 0.80 },
      ]),
      query: vi.fn().mockResolvedValue({ rows: [] }),
    };
    vi.mocked(createAdapters).mockResolvedValue({ storage: mockStorage as never, source: null });

    const handler = getHandler('semantic_search');
    const result = await handler({ query: 'missing issue' }) as { content: { text: string }[] };
    const text = result.content[0].text;

    expect(text).toContain(SEARCH_TEST_IDS.ghostKey);
    expect(text).toContain('80.0% match');
    expect(mockStorage.close).toHaveBeenCalled();
  });

  it('passes limit and threshold arguments to semanticSearch', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({ ok: true, root: '/ws', config: { version: 1, sources: {}, order: [], createdAt: '2025-01-01' } });

    const semanticSearchFn = vi.fn().mockResolvedValue([]);
    const mockStorage = {
      close: vi.fn().mockResolvedValue(undefined),
      semanticSearch: semanticSearchFn,
    };
    vi.mocked(createAdapters).mockResolvedValue({ storage: mockStorage as never, source: null });

    const handler = getHandler('semantic_search');
    await handler({ query: 'crash on startup', limit: 5, threshold: 0.7 });

    expect(semanticSearchFn).toHaveBeenCalledWith(expect.any(Array), 5, 0.7);
  });

  it('uses default limit 10 and threshold 0.5 when not provided', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({ ok: true, root: '/ws', config: { version: 1, sources: {}, order: [], createdAt: '2025-01-01' } });

    const semanticSearchFn = vi.fn().mockResolvedValue([]);
    const mockStorage = {
      close: vi.fn().mockResolvedValue(undefined),
      semanticSearch: semanticSearchFn,
    };
    vi.mocked(createAdapters).mockResolvedValue({ storage: mockStorage as never, source: null });

    const handler = getHandler('semantic_search');
    await handler({ query: 'crash on startup' });

    expect(semanticSearchFn).toHaveBeenCalledWith(expect.any(Array), 10, 0.5);
  });

  it('returns errorResponse and calls close when an unexpected error is thrown', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({ ok: true, root: '/ws', config: { version: 1, sources: {}, order: [], createdAt: '2025-01-01' } });

    const mockStorage = {
      close: vi.fn().mockResolvedValue(undefined),
      semanticSearch: vi.fn().mockRejectedValue(new Error('pgvector extension not installed')),
    };
    vi.mocked(createAdapters).mockResolvedValue({ storage: mockStorage as never, source: null });

    const handler = getHandler('semantic_search');
    const result = await handler({ query: 'test query' }) as { content: { text: string }[]; isError?: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('pgvector extension not installed');
    expect(mockStorage.close).toHaveBeenCalled();
  });
});
