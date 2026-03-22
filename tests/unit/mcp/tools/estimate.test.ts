import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ESTIMATE_TEST_IDS } from '../../../fixtures/shared/test-constants.js';
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
let registerEstimateTools: typeof import('../../../../src/mcp/tools/estimate.js').registerEstimateTools;
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

interface ToolResult {
  content: { type: string; text: string }[];
  isError?: boolean;
}

function getText(result: ToolResult): string {
  return result.content[0]?.text ?? '';
}

const SIMILAR_ROW = {
  issue_key: ESTIMATE_TEST_IDS.issueKey,
  summary: 'Implement payment flow',
  issue_type: 'Story',
  status: 'Done',
  assignee: ESTIMATE_TEST_IDS.assignee,
  created: '2025-01-01T00:00:00Z',
  resolved: '2025-01-10T00:00:00Z',
  parent_key: null,
  story_points: 5,
  components: ['Payments'],
  labels: [],
  original_estimate: 28800,
  time_spent: 14400,
  type_match: 1.0,
  component_overlap: 1.0,
  temporal_weight: '0.9',
  composite_score: '0.85',
  rank: '0.85',
};

function setupFullMockChain(): void {
  mockStorage.query
    .mockResolvedValueOnce({ rows: [SIMILAR_ROW] })
    .mockResolvedValueOnce({ rows: [{ issue_key: ESTIMATE_TEST_IDS.issueKey, author: ESTIMATE_TEST_IDS.assignee, total_seconds: '14400' }] })
    .mockResolvedValueOnce({ rows: [{ issue_key: ESTIMATE_TEST_IDS.issueKey, dev_assignee: ESTIMATE_TEST_IDS.assignee }] })
    .mockResolvedValueOnce({
      rows: [{
        issue_key: ESTIMATE_TEST_IDS.issueKey, commits: '3', authors: ESTIMATE_TEST_IDS.assignee,
        total_additions: '120', total_deletions: '30',
        first_commit: '2025-01-02T10:00:00Z', last_commit: '2025-01-08T16:00:00Z',
      }],
    })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ issue_key: ESTIMATE_TEST_IDS.issueKey, original_estimate: 28800, time_spent: 14400 }] })
    .mockResolvedValueOnce({
      rows: [{
        component: 'Payments', resolved_count: 3, avg_time_hours: 4.0, last_resolved: '2025-01-15',
      }],
    })
    .mockResolvedValueOnce({
      rows: [{
        assignee: ESTIMATE_TEST_IDS.assignee, task_count: '5',
        coeff_no_bugs: '0.85', coeff_with_bugs: '1.05',
        bug_ratio: '0.10', context_label: 'Story',
      }],
    });
}

beforeEach(async () => {
  vi.clearAllMocks();
  registeredTools.clear();
  mockStorage.query.mockReset();
  mockStorage.close.mockResolvedValue(undefined);

  const helpers = await import('../../../../src/mcp/helpers.js');
  loadWorkspace = helpers.loadWorkspace;
  createAdapters = helpers.createAdapters;

  vi.mocked(createAdapters).mockResolvedValue({
    storage: mockStorage as never,
    source: null,
  });

  const toolModule = await import('../../../../src/mcp/tools/estimate.js');
  registerEstimateTools = toolModule.registerEstimateTools;
});

function getHandler(): ToolHandler {
  registerEstimateTools(mockServer as unknown as McpServer);
  const handler = registeredTools.get('estimate');
  if (!handler) {throw new Error('Tool estimate not registered');}
  return handler;
}

describe('estimate tool', () => {
  it('registers the estimate tool', () => {
    registerEstimateTools(mockServer as unknown as McpServer);
    expect(mockServer.registerTool).toHaveBeenCalledWith('estimate', expect.any(Object), expect.any(Function));
  });

  it('returns error when workspace not found', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({ ok: false, reason: 'not found' });

    const handler = getHandler();
    const result = await handler({ description: 'test', assignee: ESTIMATE_TEST_IDS.assignee }) as ToolResult;

    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('Workspace not found');
  });

  it('returns message when no similar tasks found', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({
      ok: true, root: '/test', config: { createdAt: '2025-01-01', sources: {} },
    });
    mockStorage.query.mockResolvedValueOnce({ rows: [] });

    const handler = getHandler();
    const result = await handler({ description: 'some task', assignee: ESTIMATE_TEST_IDS.assignee }) as ToolResult;

    expect(result.isError).toBeUndefined();
    expect(getText(result)).toContain('No similar completed tasks found');
    expect(mockStorage.close).toHaveBeenCalled();
  });

  it('returns full prediction with coefficients', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({
      ok: true, root: '/test', config: { createdAt: '2025-01-01', sources: {} },
    });
    setupFullMockChain();

    const handler = getHandler();
    const result = await handler({
      description: 'payment integration',
      assignee: ESTIMATE_TEST_IDS.assignee,
      issue_type: 'Story',
      components: ['Payments'],
    }) as ToolResult;

    const text = getText(result);
    expect(text).toContain('Estimate Prediction');
    expect(text).toContain(ESTIMATE_TEST_IDS.issueKey);
    expect(text).toContain(ESTIMATE_TEST_IDS.assignee);
    expect(text).toContain('Without bugs');
    expect(text).toContain('With bugs');
    expect(mockStorage.close).toHaveBeenCalled();
  });

  it('skips familiarity query when no components provided', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({
      ok: true, root: '/test', config: { createdAt: '2025-01-01', sources: {} },
    });

    mockStorage.query
      .mockResolvedValueOnce({ rows: [SIMILAR_ROW] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ issue_key: ESTIMATE_TEST_IDS.issueKey, original_estimate: 28800, time_spent: 14400 }] })
      .mockResolvedValueOnce({ rows: [] });

    const handler = getHandler();
    const result = await handler({
      description: 'some task',
      assignee: ESTIMATE_TEST_IDS.assignee,
    }) as ToolResult;

    const text = getText(result);
    expect(text).toContain('Estimate Prediction');
    expect(text).not.toContain('Developer Familiarity');
  });

  it('shows resolution timeline when only cycle time data available', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({
      ok: true, root: '/test', config: { createdAt: '2025-01-01', sources: {} },
    });

    const cycleFallbackRow = {
      ...SIMILAR_ROW,
      original_estimate: null,
      time_spent: null,
    };

    mockStorage.query
      .mockResolvedValueOnce({ rows: [cycleFallbackRow] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ issue_key: ESTIMATE_TEST_IDS.issueKey, original_estimate: null, time_spent: null }] })
      .mockResolvedValueOnce({ rows: [] });

    const handler = getHandler();
    const result = await handler({
      description: 'some task',
      assignee: ESTIMATE_TEST_IDS.assignee,
    }) as ToolResult;

    const text = getText(result);
    expect(text).toContain('Resolution Timeline');
    expect(text).toContain('business days');
  });

  it('shows no-data message when baseHours is 0 and not cycle fallback', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({
      ok: true, root: '/test', config: { createdAt: '2025-01-01', sources: {} },
    });

    const noDataRow = {
      ...SIMILAR_ROW,
      original_estimate: null,
      time_spent: null,
      resolved: null,
    };

    mockStorage.query
      .mockResolvedValueOnce({ rows: [noDataRow] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ issue_key: ESTIMATE_TEST_IDS.issueKey, original_estimate: null, time_spent: null }] })
      .mockResolvedValueOnce({ rows: [] });

    const handler = getHandler();
    const result = await handler({
      description: 'some task',
      assignee: ESTIMATE_TEST_IDS.assignee,
    }) as ToolResult;

    const text = getText(result);
    expect(text).toContain('No data available for prediction');
  });

  it('shows message when no coefficient data for assignee', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({
      ok: true, root: '/test', config: { createdAt: '2025-01-01', sources: {} },
    });

    mockStorage.query
      .mockResolvedValueOnce({ rows: [SIMILAR_ROW] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ issue_key: ESTIMATE_TEST_IDS.issueKey, original_estimate: 28800, time_spent: 14400 }] })
      .mockResolvedValueOnce({ rows: [] });

    const handler = getHandler();
    const result = await handler({
      description: 'some task',
      assignee: 'Unknown Dev',
    }) as ToolResult;

    const text = getText(result);
    expect(text).toContain('No coefficient data');
    expect(text).toContain('Unknown Dev');
  });

  it('returns error when storage throws', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({
      ok: true, root: '/test', config: { createdAt: '2025-01-01', sources: {} },
    });
    mockStorage.query.mockRejectedValueOnce(new Error('DB connection failed'));

    const handler = getHandler();
    const result = await handler({ description: 'test', assignee: ESTIMATE_TEST_IDS.assignee }) as ToolResult;

    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('Estimate failed');
    expect(getText(result)).toContain('DB connection failed');
    expect(mockStorage.close).toHaveBeenCalled();
  });

  it('includes bug aftermath in output when bugs exist', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({
      ok: true, root: '/test', config: { createdAt: '2025-01-01', sources: {} },
    });

    mockStorage.query
      .mockResolvedValueOnce({ rows: [SIMILAR_ROW] })
      .mockResolvedValueOnce({ rows: [{ issue_key: ESTIMATE_TEST_IDS.issueKey, author: ESTIMATE_TEST_IDS.assignee, total_seconds: '14400' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{
          related_to: ESTIMATE_TEST_IDS.issueKey, bug_key: ESTIMATE_TEST_IDS.bugKey, summary: 'Payment crash',
          issue_type: 'Bug', resolved: '2025-01-12', created: '2025-01-11', bug_time_spent: 3600,
        }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ issue_key: ESTIMATE_TEST_IDS.issueKey, original_estimate: 28800, time_spent: 14400 }] })
      .mockResolvedValueOnce({ rows: [] });

    const handler = getHandler();
    const result = await handler({
      description: 'payment feature',
      assignee: ESTIMATE_TEST_IDS.assignee,
    }) as ToolResult;

    const text = getText(result);
    expect(text).toContain(ESTIMATE_TEST_IDS.bugKey);
    expect(text).toContain('Payment crash');
    expect(text).toContain('Bug');
  });

  it('respects exclude_key parameter', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({
      ok: true, root: '/test', config: { createdAt: '2025-01-01', sources: {} },
    });
    mockStorage.query.mockResolvedValueOnce({ rows: [] });

    const handler = getHandler();
    await handler({
      description: 'test',
      assignee: ESTIMATE_TEST_IDS.assignee,
      exclude_key: ESTIMATE_TEST_IDS.excludeKey,
    });

    const firstCall = mockStorage.query.mock.calls[0];
    const params = firstCall?.[1] as unknown[];
    expect(params).toContain(ESTIMATE_TEST_IDS.excludeKey);
  });

  it('respects limit parameter', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({
      ok: true, root: '/test', config: { createdAt: '2025-01-01', sources: {} },
    });
    mockStorage.query.mockResolvedValueOnce({ rows: [] });

    const handler = getHandler();
    await handler({
      description: 'test',
      assignee: ESTIMATE_TEST_IDS.assignee,
      limit: 5,
    });

    const firstCall = mockStorage.query.mock.calls[0];
    const params = firstCall?.[1] as unknown[];
    expect(params).toContain(5);
  });

  it('includes scoring method in output', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({
      ok: true, root: '/test', config: { createdAt: '2025-01-01', sources: {} },
    });
    setupFullMockChain();

    const handler = getHandler();
    const result = await handler({
      description: 'payment integration',
      assignee: ESTIMATE_TEST_IDS.assignee,
      issue_type: 'Story',
      components: ['Payments'],
    }) as ToolResult;

    const text = getText(result);
    expect(text).toContain('Scoring:');
    expect(text).toContain('text');
    expect(text).toContain('type');
    expect(text).toContain('component');
    expect(text).toContain('recency');
  });
});
