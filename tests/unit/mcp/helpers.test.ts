/**
 * Unit tests for MCP helper utilities.
 *
 * Covers pure utility functions (textResponse, errorResponse, getErrorMessage, str),
 * the workspace-loading logic (loadWorkspace), and the adapter-creation logic
 * (createAdapters). External modules (workspace resolver, config reader, dotenv,
 * Jira adapter, and Postgres adapter) are all mocked at module boundaries so
 * every path can be exercised without touching the filesystem or a real database.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createWorkspaceConfig } from '../../fixtures/shared/test-constants.js';

vi.mock('../../../src/workspace/resolver.js', () => ({
  findWorkspaceRoot: vi.fn(),
}));

vi.mock('../../../src/workspace/config.js', () => ({
  readConfig: vi.fn(),
  getEnabledSources: vi.fn(),
}));

vi.mock('dotenv', () => ({
  default: { config: vi.fn() },
}));

vi.mock('../../../src/adapters/jira/index.js', () => ({
  JiraProvider: vi.fn(function JiraProvider(this: { name: string }) {
    this.name = 'Jira';
  }),
}));

vi.mock('../../../src/adapters/postgres/index.js', () => ({
  PostgresStorage: vi.fn(function PostgresStorage(this: { name: string }) {
    this.name = 'PostgreSQL';
  }),
}));

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let loadWorkspace: typeof import('../../../src/mcp/helpers.js').loadWorkspace;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let createAdapters: typeof import('../../../src/mcp/helpers.js').createAdapters;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let textResponse: typeof import('../../../src/mcp/helpers.js').textResponse;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let errorResponse: typeof import('../../../src/mcp/helpers.js').errorResponse;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let getErrorMessage: typeof import('../../../src/mcp/helpers.js').getErrorMessage;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let str: typeof import('../../../src/mcp/helpers.js').str;

let findWorkspaceRoot: ReturnType<typeof vi.fn>;
let readConfig: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.clearAllMocks();

  const resolverModule = await import('../../../src/workspace/resolver.js');
  findWorkspaceRoot = vi.mocked(resolverModule.findWorkspaceRoot);

  const configModule = await import('../../../src/workspace/config.js');
  readConfig = vi.mocked(configModule.readConfig);

  const helpers = await import('../../../src/mcp/helpers.js');
  loadWorkspace = helpers.loadWorkspace;
  createAdapters = helpers.createAdapters;
  textResponse = helpers.textResponse;
  errorResponse = helpers.errorResponse;
  getErrorMessage = helpers.getErrorMessage;
  str = helpers.str;
});

// ─── textResponse ──────────────────────────────────────────────────────────

describe('textResponse', () => {
  it('returns content array with type text', () => {
    const result = textResponse('hello');

    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toEqual({ type: 'text', text: 'hello' });
  });

  it('does not set isError field', () => {
    const result = textResponse('hello');

    expect(result.isError).toBeUndefined();
  });
});

// ─── errorResponse ─────────────────────────────────────────────────────────

describe('errorResponse', () => {
  it('returns content array with type text', () => {
    const result = errorResponse('something went wrong');

    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toEqual({ type: 'text', text: 'something went wrong' });
  });

  it('sets isError to true', () => {
    const result = errorResponse('something went wrong');

    expect(result.isError).toBe(true);
  });
});

// ─── getErrorMessage ───────────────────────────────────────────────────────

describe('getErrorMessage', () => {
  it('extracts message from Error instance', () => {
    const err = new Error('connection refused');

    expect(getErrorMessage(err)).toBe('connection refused');
  });

  it('converts non-Error value to string', () => {
    expect(getErrorMessage('raw string')).toBe('raw string');
  });

  it('converts number to string', () => {
    expect(getErrorMessage(42)).toBe('42');
  });

  it('handles null by converting to string', () => {
    expect(getErrorMessage(null)).toBe('null');
  });

  it('handles undefined by converting to string', () => {
    expect(getErrorMessage(undefined)).toBe('undefined');
  });
});

// ─── str ───────────────────────────────────────────────────────────────────

describe('str', () => {
  it('returns empty string for null', () => {
    expect(str(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(str(undefined)).toBe('');
  });

  it('passes through string values unchanged', () => {
    expect(str('hello world')).toBe('hello world');
  });

  it('converts number to string', () => {
    expect(str(123)).toBe('123');
  });

  it('converts boolean true to string', () => {
    expect(str(true)).toBe('true');
  });

  it('converts boolean false to string', () => {
    expect(str(false)).toBe('false');
  });

  it('converts Date to ISO string', () => {
    const date = new Date('2025-01-15T10:00:00.000Z');

    expect(str(date)).toBe('2025-01-15T10:00:00.000Z');
  });

  it('JSON.stringifies plain objects', () => {
    const obj = { key: 'value' };

    expect(str(obj)).toBe(JSON.stringify(obj));
  });

  it('JSON.stringifies arrays', () => {
    const arr = [1, 2, 3];

    expect(str(arr)).toBe(JSON.stringify(arr));
  });
});

// ─── loadWorkspace ─────────────────────────────────────────────────────────

describe('loadWorkspace', () => {
  it('returns ok:true when root is found and config is valid', () => {
    const root = '/workspace/root';
    const config = createWorkspaceConfig();
    findWorkspaceRoot.mockReturnValue(root);
    readConfig.mockReturnValue(config);

    const result = loadWorkspace();

    expect(result).toEqual({ ok: true, root, config });
  });

  it('returns ok:false when no root found and no env var set', () => {
    delete process.env['ARGUSTACK_WORKSPACE'];
    findWorkspaceRoot.mockReturnValue(null);

    const result = loadWorkspace();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(typeof result.reason).toBe('string');
      expect(result.reason.length).toBeGreaterThan(0);
    }
  });

  it('returns ok:false with env var hint when env var is set but root not found', () => {
    process.env['ARGUSTACK_WORKSPACE'] = '/custom/path';
    findWorkspaceRoot.mockReturnValue(null);

    const result = loadWorkspace();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('ARGUSTACK_WORKSPACE is set to "/custom/path"');
      expect(result.reason).toContain('.argustack/');
    }

    delete process.env['ARGUSTACK_WORKSPACE'];
  });

  it('returns ok:false when root found but config is missing', () => {
    const root = '/workspace/root';
    findWorkspaceRoot.mockReturnValue(root);
    readConfig.mockReturnValue(null);

    const result = loadWorkspace();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain(root);
      expect(result.reason).toContain('argustack init');
    }
  });
});

// ─── createAdapters ────────────────────────────────────────────────────────

describe('createAdapters', () => {
  const workspaceRoot = '/workspace/root';

  beforeEach(() => {
    delete process.env['JIRA_URL'];
    delete process.env['JIRA_EMAIL'];
    delete process.env['JIRA_API_TOKEN'];
    delete process.env['DB_HOST'];
    delete process.env['DB_PORT'];
    delete process.env['DB_USER'];
    delete process.env['DB_PASSWORD'];
    delete process.env['DB_NAME'];
  });

  it('returns null source when Jira env vars are not set', async () => {
    const { source } = await createAdapters(workspaceRoot);

    expect(source).toBeNull();
  });

  it('creates JiraProvider when all three Jira env vars are present', async () => {
    process.env['JIRA_URL'] = 'https://example.atlassian.net';
    process.env['JIRA_EMAIL'] = 'user@example.com';
    process.env['JIRA_API_TOKEN'] = 'secret-token';

    const { source } = await createAdapters(workspaceRoot);
    const jiraModule = await import('../../../src/adapters/jira/index.js');
    const MockJiraProvider = vi.mocked(jiraModule.JiraProvider);

    expect(source).not.toBeNull();
    expect(MockJiraProvider).toHaveBeenCalledWith({
      host: 'https://example.atlassian.net',
      email: 'user@example.com',
      apiToken: 'secret-token',
    }, undefined);
  });

  it('creates PostgresStorage with default values when DB env vars are absent', async () => {
    await createAdapters(workspaceRoot);
    const postgresModule = await import('../../../src/adapters/postgres/index.js');
    const MockPostgresStorage = vi.mocked(postgresModule.PostgresStorage);

    expect(MockPostgresStorage).toHaveBeenCalledWith({
      host: 'localhost',
      port: 5434,
      user: 'argustack',
      password: 'argustack_local',
      database: 'argustack',
    });
  });

  it('creates PostgresStorage with custom values from env when DB env vars are set', async () => {
    process.env['DB_HOST'] = 'db.internal';
    process.env['DB_PORT'] = '5432';
    process.env['DB_USER'] = 'myuser';
    process.env['DB_PASSWORD'] = 'mypassword';
    process.env['DB_NAME'] = 'mydb';

    await createAdapters(workspaceRoot);
    const postgresModule = await import('../../../src/adapters/postgres/index.js');
    const MockPostgresStorage = vi.mocked(postgresModule.PostgresStorage);

    expect(MockPostgresStorage).toHaveBeenCalledWith({
      host: 'db.internal',
      port: 5432,
      user: 'myuser',
      password: 'mypassword',
      database: 'mydb',
    });
  });

  it('calls dotenv.config with the workspace .env path', async () => {
    const dotenvModule = await import('dotenv');
    const dotenvConfig = vi.mocked(dotenvModule.default.config);

    await createAdapters(workspaceRoot);

    expect(dotenvConfig).toHaveBeenCalledWith({
      path: `${workspaceRoot}/.env`,
      override: true,
    });
  });

  it('returns a storage instance when createAdapters resolves', async () => {
    const { storage } = await createAdapters(workspaceRoot);

    expect(storage).toBeDefined();
    expect(storage).not.toBeNull();
  });
});
