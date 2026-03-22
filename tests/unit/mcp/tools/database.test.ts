/**
 * Unit tests for registerDatabaseTools.
 *
 * Covers all three tools: db_schema, db_query, db_stats.
 * Each tool handler is captured at registration time and exercised
 * directly, without starting the full MCP transport.
 * All external dependencies (helpers, DbProvider, dotenv) are mocked
 * at the module boundary.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
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

vi.mock('../../../../src/adapters/db/index.js', () => {
  const DbProvider = vi.fn(function (this: Record<string, unknown>) {
    this.connect = vi.fn();
    this.query = vi.fn();
    this.disconnect = vi.fn();
  });
  return { DbProvider };
});

vi.mock('dotenv', () => ({
  default: { config: vi.fn() },
  config: vi.fn(),
}));

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let registerDatabaseTools: typeof import('../../../../src/mcp/tools/database.js').registerDatabaseTools;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let loadWorkspace: typeof import('../../../../src/mcp/helpers.js').loadWorkspace;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let createAdapters: typeof import('../../../../src/mcp/helpers.js').createAdapters;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let DbProvider: typeof import('../../../../src/adapters/db/index.js').DbProvider;

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
  delete process.env['TARGET_DB_HOST'];
  delete process.env['TARGET_DB_USER'];
  delete process.env['TARGET_DB_NAME'];
  delete process.env['TARGET_DB_ENGINE'];
  delete process.env['TARGET_DB_PORT'];
  delete process.env['TARGET_DB_PASSWORD'];

  const helpers = await import('../../../../src/mcp/helpers.js');
  loadWorkspace = helpers.loadWorkspace;
  createAdapters = helpers.createAdapters;

  const dbModule = await import('../../../../src/adapters/db/index.js');
  DbProvider = dbModule.DbProvider;

  const toolModule = await import('../../../../src/mcp/tools/database.js');
  registerDatabaseTools = toolModule.registerDatabaseTools;
  registerDatabaseTools(mockServer as unknown as McpServer);
});

// ─── db_schema ────────────────────────────────────────────────────────────────

describe('db_schema', () => {
  it('returns errorResponse when workspace is not found', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({ ok: false, reason: 'no .argustack dir' });

    const handler = getHandler('db_schema');
    const result = await handler({}) as { content: { text: string }[]; isError?: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Workspace not found');
  });

  it('returns "No tables found" message when db_tables query returns empty rows', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({ ok: true, root: '/ws', config: { version: 1, sources: {}, order: [], createdAt: '2025-01-01' } });
    const mockStorage = {
      initialize: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockResolvedValue({ rows: [] }),
    };
    vi.mocked(createAdapters).mockResolvedValue({ storage: mockStorage as never, source: null });

    const handler = getHandler('db_schema');
    const result = await handler({}) as { content: { text: string }[] };

    expect(result.content[0].text).toContain('No tables found');
    expect(mockStorage.close).toHaveBeenCalled();
  });

  it('returns formatted schema with columns, FK, and indexes when tables are found', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({ ok: true, root: '/ws', config: { version: 1, sources: {}, order: [], createdAt: '2025-01-01' } });

    const tableRows = [
      { source_name: 'pg', table_schema: 'public', table_name: 'users', row_count: 100, size_bytes: 8192 },
    ];
    const columnRows = [
      { table_name: 'users', column_name: 'id', data_type: 'integer', is_nullable: false, default_value: null, is_primary_key: true, ordinal_position: 1 },
    ];
    const fkRows = [
      { table_name: 'users', column_name: 'org_id', referenced_table: 'orgs', referenced_column: 'id' },
    ];
    const indexRows = [
      { table_name: 'users', index_name: 'users_pkey', columns: ['id'], is_unique: true, is_primary: true },
    ];

    const mockStorage = {
      initialize: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      query: vi.fn()
        .mockResolvedValueOnce({ rows: tableRows })
        .mockResolvedValueOnce({ rows: columnRows })
        .mockResolvedValueOnce({ rows: fkRows })
        .mockResolvedValueOnce({ rows: indexRows }),
    };
    vi.mocked(createAdapters).mockResolvedValue({ storage: mockStorage as never, source: null });

    const handler = getHandler('db_schema');
    const result = await handler({}) as { content: { text: string }[] };
    const text = result.content[0].text;

    expect(text).toContain('public.users');
    expect(text).toContain('id: integer');
    expect(text).toContain('PK');
    expect(text).toContain('NOT NULL');
    expect(text).toContain('Foreign keys:');
    expect(text).toContain('org_id → orgs.id');
    expect(text).toContain('Indexes:');
    expect(text).toContain('users_pkey');
    expect(text).toContain('UNIQUE');
    expect(mockStorage.close).toHaveBeenCalled();
  });

  it('includes ILIKE condition in SQL when table filter is provided', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({ ok: true, root: '/ws', config: { version: 1, sources: {}, order: [], createdAt: '2025-01-01' } });

    const mockStorage = {
      initialize: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockResolvedValue({ rows: [] }),
    };
    vi.mocked(createAdapters).mockResolvedValue({ storage: mockStorage as never, source: null });

    const handler = getHandler('db_schema');
    await handler({ table: 'users' });

    const firstCall = mockStorage.query.mock.calls[0] as [string, unknown[]];
    expect(firstCall[0]).toContain('ILIKE');
    expect(firstCall[1]).toContain('%users%');
  });

  it('includes exact match condition in SQL when source filter is provided', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({ ok: true, root: '/ws', config: { version: 1, sources: {}, order: [], createdAt: '2025-01-01' } });

    const mockStorage = {
      initialize: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockResolvedValue({ rows: [] }),
    };
    vi.mocked(createAdapters).mockResolvedValue({ storage: mockStorage as never, source: null });

    const handler = getHandler('db_schema');
    await handler({ source: 'pg-prod' });

    const firstCall = mockStorage.query.mock.calls[0] as [string, unknown[]];
    expect(firstCall[0]).toContain('source_name = $1');
    expect(firstCall[1]).toContain('pg-prod');
  });

  it('returns errorResponse and calls close when an error is thrown during query', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({ ok: true, root: '/ws', config: { version: 1, sources: {}, order: [], createdAt: '2025-01-01' } });

    const mockStorage = {
      initialize: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockRejectedValue(new Error('connection refused')),
    };
    vi.mocked(createAdapters).mockResolvedValue({ storage: mockStorage as never, source: null });

    const handler = getHandler('db_schema');
    const result = await handler({}) as { content: { text: string }[]; isError?: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('connection refused');
    expect(mockStorage.close).toHaveBeenCalled();
  });

  it('formats row count and size in the table header when present', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({ ok: true, root: '/ws', config: { version: 1, sources: {}, order: [], createdAt: '2025-01-01' } });

    const tableRows = [
      { source_name: 'pg', table_schema: 'public', table_name: 'events', row_count: 50000, size_bytes: 1024 * 1024 },
    ];

    const mockStorage = {
      initialize: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      query: vi.fn()
        .mockResolvedValueOnce({ rows: tableRows })
        .mockResolvedValue({ rows: [] }),
    };
    vi.mocked(createAdapters).mockResolvedValue({ storage: mockStorage as never, source: null });

    const handler = getHandler('db_schema');
    const result = await handler({}) as { content: { text: string }[] };
    const text = result.content[0].text;

    expect(text).toContain('50000 rows');
    expect(text).toContain('1MB');
  });
});

// ─── db_query ────────────────────────────────────────────────────────────────

describe('db_query', () => {
  it('returns errorResponse when workspace is not found', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({ ok: false, reason: 'missing config' });

    const handler = getHandler('db_query');
    const result = await handler({ sql: 'SELECT 1' }) as { content: { text: string }[]; isError?: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Workspace not found');
  });

  it('returns errorResponse when TARGET_DB_HOST is not configured', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({ ok: true, root: '/ws', config: { version: 1, sources: {}, order: [], createdAt: '2025-01-01' } });

    const handler = getHandler('db_query');
    const result = await handler({ sql: 'SELECT 1' }) as { content: { text: string }[]; isError?: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('No target database configured');
    expect(result.content[0].text).toContain('TARGET_DB_HOST');
  });

  it('returns "Query returned 0 rows" when db.query returns empty rows', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({ ok: true, root: '/ws', config: { version: 1, sources: {}, order: [], createdAt: '2025-01-01' } });
    process.env['TARGET_DB_HOST'] = 'localhost';
    process.env['TARGET_DB_USER'] = 'admin';
    process.env['TARGET_DB_NAME'] = 'mydb';

    const connectFn = vi.fn().mockResolvedValue(undefined);
    const queryFn = vi.fn().mockResolvedValue({ rows: [] });
    const disconnectFn = vi.fn().mockResolvedValue(undefined);
    vi.mocked(DbProvider).mockImplementation(function (this: Record<string, unknown>) {
      this.connect = connectFn;
      this.query = queryFn;
      this.disconnect = disconnectFn;
    } as never);

    const handler = getHandler('db_query');
    const result = await handler({ sql: 'SELECT * FROM empty_table' }) as { content: { text: string }[] };

    expect(result.content[0].text).toContain('Query returned 0 rows');
    expect(disconnectFn).toHaveBeenCalled();
  });

  it('returns formatted table with header, separator, and rows when query returns data', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({ ok: true, root: '/ws', config: { version: 1, sources: {}, order: [], createdAt: '2025-01-01' } });
    process.env['TARGET_DB_HOST'] = 'localhost';
    process.env['TARGET_DB_USER'] = 'admin';
    process.env['TARGET_DB_NAME'] = 'mydb';

    const connectFn = vi.fn().mockResolvedValue(undefined);
    const queryFn = vi.fn().mockResolvedValue({
      rows: [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ],
    });
    const disconnectFn = vi.fn().mockResolvedValue(undefined);
    vi.mocked(DbProvider).mockImplementation(function (this: Record<string, unknown>) {
      this.connect = connectFn;
      this.query = queryFn;
      this.disconnect = disconnectFn;
    } as never);

    const handler = getHandler('db_query');
    const result = await handler({ sql: 'SELECT id, name FROM users' }) as { content: { text: string }[] };
    const text = result.content[0].text;

    expect(text).toContain('2 rows');
    expect(text).toContain('id | name');
    expect(text).toContain('-- | ----');
    expect(text).toContain('1 | Alice');
    expect(text).toContain('2 | Bob');
    expect(disconnectFn).toHaveBeenCalled();
  });

  it('returns errorResponse and disconnects when query throws an error', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({ ok: true, root: '/ws', config: { version: 1, sources: {}, order: [], createdAt: '2025-01-01' } });
    process.env['TARGET_DB_HOST'] = 'localhost';
    process.env['TARGET_DB_USER'] = 'admin';
    process.env['TARGET_DB_NAME'] = 'mydb';

    const connectFn = vi.fn().mockResolvedValue(undefined);
    const queryFn = vi.fn().mockRejectedValue(new Error('syntax error at position 5'));
    const disconnectFn = vi.fn().mockResolvedValue(undefined);
    vi.mocked(DbProvider).mockImplementation(function (this: Record<string, unknown>) {
      this.connect = connectFn;
      this.query = queryFn;
      this.disconnect = disconnectFn;
    } as never);

    const handler = getHandler('db_query');
    const result = await handler({ sql: 'SELEC * FROM users' }) as { content: { text: string }[]; isError?: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('syntax error at position 5');
    expect(disconnectFn).toHaveBeenCalled();
  });

  it('uses postgresql as default engine when TARGET_DB_ENGINE is not set', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({ ok: true, root: '/ws', config: { version: 1, sources: {}, order: [], createdAt: '2025-01-01' } });
    process.env['TARGET_DB_HOST'] = 'localhost';
    process.env['TARGET_DB_USER'] = 'admin';
    process.env['TARGET_DB_NAME'] = 'mydb';

    vi.mocked(DbProvider).mockImplementation(function (this: Record<string, unknown>) {
      this.connect = vi.fn().mockResolvedValue(undefined);
      this.query = vi.fn().mockResolvedValue({ rows: [] });
      this.disconnect = vi.fn().mockResolvedValue(undefined);
    } as never);

    const handler = getHandler('db_query');
    await handler({ sql: 'SELECT 1' });

    const constructorCall = vi.mocked(DbProvider).mock.calls[0] as [{ engine: string }[]];
    expect(constructorCall[0]).toMatchObject({ engine: 'postgresql' });
  });
});

// ─── db_stats ────────────────────────────────────────────────────────────────

describe('db_stats', () => {
  it('returns errorResponse when workspace is not found', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({ ok: false, reason: 'no workspace' });

    const handler = getHandler('db_stats');
    const result = await handler({}) as { content: { text: string }[]; isError?: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Workspace not found');
  });

  it('returns "No database schema data found" when stats query returns no rows', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({ ok: true, root: '/ws', config: { version: 1, sources: {}, order: [], createdAt: '2025-01-01' } });

    const mockStorage = {
      initialize: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockResolvedValue({ rows: [] }),
    };
    vi.mocked(createAdapters).mockResolvedValue({ storage: mockStorage as never, source: null });

    const handler = getHandler('db_stats');
    const result = await handler({}) as { content: { text: string }[] };

    expect(result.content[0].text).toContain('No database schema data found');
    expect(mockStorage.close).toHaveBeenCalled();
  });

  it('returns stats with total tables, columns, FKs, indexes, by-schema section, and largest tables', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({ ok: true, root: '/ws', config: { version: 1, sources: {}, order: [], createdAt: '2025-01-01' } });

    const statsRows = [{ total_tables: '5', total_columns: '30', total_fks: '4', total_indexes: '8' }];
    const schemaRows = [{ table_schema: 'public', table_count: '5', total_rows: '5000' }];
    const largestRows = [
      { table_name: 'events', row_count: 4000, size_bytes: 2 * 1024 * 1024 },
      { table_name: 'users', row_count: 1000, size_bytes: 65536 },
    ];

    const mockStorage = {
      initialize: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      query: vi.fn()
        .mockResolvedValueOnce({ rows: statsRows })
        .mockResolvedValueOnce({ rows: schemaRows })
        .mockResolvedValueOnce({ rows: largestRows }),
    };
    vi.mocked(createAdapters).mockResolvedValue({ storage: mockStorage as never, source: null });

    const handler = getHandler('db_stats');
    const result = await handler({}) as { content: { text: string }[] };
    const text = result.content[0].text;

    expect(text).toContain('Tables: 5');
    expect(text).toContain('Columns: 30');
    expect(text).toContain('Foreign keys: 4');
    expect(text).toContain('Indexes: 8');
    expect(text).toContain('By schema:');
    expect(text).toContain('public: 5 tables');
    expect(text).toContain('Largest tables');
    expect(text).toContain('events: ~4000 rows');
    expect(text).toContain('2MB');
    expect(mockStorage.close).toHaveBeenCalled();
  });

  it('passes source filter as WHERE clause param when source is provided', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({ ok: true, root: '/ws', config: { version: 1, sources: {}, order: [], createdAt: '2025-01-01' } });

    const statsRows = [{ total_tables: '2', total_columns: '10', total_fks: '1', total_indexes: '2' }];
    const mockStorage = {
      initialize: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      query: vi.fn()
        .mockResolvedValueOnce({ rows: statsRows })
        .mockResolvedValue({ rows: [] }),
    };
    vi.mocked(createAdapters).mockResolvedValue({ storage: mockStorage as never, source: null });

    const handler = getHandler('db_stats');
    await handler({ source: 'prod-db' });

    const firstCall = mockStorage.query.mock.calls[0] as [string, unknown[]];
    expect(firstCall[0]).toContain('WHERE source_name = $1');
    expect(firstCall[1]).toContain('prod-db');
  });

  it('returns errorResponse and calls close when query throws', async () => {
    vi.mocked(loadWorkspace).mockReturnValue({ ok: true, root: '/ws', config: { version: 1, sources: {}, order: [], createdAt: '2025-01-01' } });

    const mockStorage = {
      initialize: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockRejectedValue(new Error('pg pool exhausted')),
    };
    vi.mocked(createAdapters).mockResolvedValue({ storage: mockStorage as never, source: null });

    const handler = getHandler('db_stats');
    const result = await handler({}) as { content: { text: string }[]; isError?: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('pg pool exhausted');
    expect(mockStorage.close).toHaveBeenCalled();
  });
});
