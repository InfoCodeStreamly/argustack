/**
 * Unit tests for MCP helper utilities.
 *
 * Covers pure utility functions (textResponse, errorResponse, getErrorMessage, str)
 * and the workspace-loading logic (loadWorkspace) using a fake workspace store.
 * The hub-config and active-workspace modules are mocked at the module boundary
 * so loadWorkspace can be exercised without touching the filesystem.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Workspace } from '../../../src/core/types/index.js';
import type { IWorkspaceStore } from '../../../src/core/ports/workspace-store.js';
import { createWorkspaceConfig } from '../../fixtures/shared/test-constants.js';

vi.mock('../../../src/workspace/hub-config.js', () => ({
  loadHubConfig: vi.fn(),
}));

vi.mock('../../../src/workspace/active-workspace.js', () => ({
  getActiveWorkspace: vi.fn(),
  setActiveWorkspace: vi.fn(),
  clearActiveWorkspace: vi.fn(),
  getActiveWorkspaceId: vi.fn(),
}));

vi.mock('../../../src/workspace/config.js', () => ({
  readWorkspaceConfigFromHub: vi.fn(),
}));

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let loadWorkspace: typeof import('../../../src/mcp/helpers.js').loadWorkspace;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let setActiveWorkspaceStore: typeof import('../../../src/mcp/helpers.js').setActiveWorkspaceStore;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let textResponse: typeof import('../../../src/mcp/helpers.js').textResponse;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let errorResponse: typeof import('../../../src/mcp/helpers.js').errorResponse;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let getErrorMessage: typeof import('../../../src/mcp/helpers.js').getErrorMessage;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let str: typeof import('../../../src/mcp/helpers.js').str;

let getActiveWorkspaceMock: ReturnType<typeof vi.fn>;
let readWorkspaceConfigFromHubMock: ReturnType<typeof vi.fn>;

function createTestWorkspace(overrides?: Partial<Workspace>): Workspace {
  return {
    id: 'ws-id',
    name: 'test-workspace',
    createdAt: '2025-01-01T00:00:00.000Z',
    lastActiveAt: '2025-01-01T00:00:00.000Z',
    settings: {},
    ...overrides,
  };
}

function createFakeStore(workspaces: Workspace[]): IWorkspaceStore {
  const byId = new Map(workspaces.map((w) => [w.id, w]));
  const byName = new Map(workspaces.map((w) => [w.name, w]));
  return {
    list: vi.fn(async () => Promise.resolve(workspaces)),
    getById: vi.fn(async (id: string) => Promise.resolve(byId.get(id) ?? null)),
    getByName: vi.fn(async (name: string) => Promise.resolve(byName.get(name) ?? null)),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    touchActive: vi.fn(async () => Promise.resolve()),
  } as unknown as IWorkspaceStore;
}

beforeEach(async () => {
  vi.clearAllMocks();

  const activeModule = await import('../../../src/workspace/active-workspace.js');
  getActiveWorkspaceMock = vi.mocked(activeModule.getActiveWorkspace);

  const configModule = await import('../../../src/workspace/config.js');
  readWorkspaceConfigFromHubMock = vi.mocked(configModule.readWorkspaceConfigFromHub);

  const helpers = await import('../../../src/mcp/helpers.js');
  loadWorkspace = helpers.loadWorkspace;
  setActiveWorkspaceStore = helpers.setActiveWorkspaceStore;
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
  beforeEach(() => {
    delete process.env['ARGUSTACK_WORKSPACE_ID'];
    getActiveWorkspaceMock.mockReturnValue(null);
  });

  it('returns ok:true when explicit id resolves to a workspace with valid config', async () => {
    const workspace = createTestWorkspace({ id: 'ws-id', name: 'test-workspace' });
    const config = createWorkspaceConfig();
    setActiveWorkspaceStore(createFakeStore([workspace]));
    readWorkspaceConfigFromHubMock.mockResolvedValue(config);

    const result = await loadWorkspace('ws-id');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.workspaceId).toBe('ws-id');
      expect(result.workspace.name).toBe('test-workspace');
      expect(result.config).toEqual(config);
    }
  });

  it('returns ok:false when explicit id does not exist', async () => {
    setActiveWorkspaceStore(createFakeStore([]));

    const result = await loadWorkspace('missing-ws');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(typeof result.reason).toBe('string');
      expect(result.reason).toContain('missing-ws');
    }
  });

  it('returns ok:false when no workspaces are registered and no hint is given', async () => {
    setActiveWorkspaceStore(createFakeStore([]));

    const result = await loadWorkspace();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason.length).toBeGreaterThan(0);
      expect(result.reason).toContain('No workspaces registered');
    }
  });

  it('returns ok:false with ARGUSTACK_WORKSPACE_ID hint when env var points to missing workspace', async () => {
    process.env['ARGUSTACK_WORKSPACE_ID'] = 'missing-env-ws';
    setActiveWorkspaceStore(createFakeStore([]));

    const result = await loadWorkspace();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('missing-env-ws');
    }

    delete process.env['ARGUSTACK_WORKSPACE_ID'];
  });

  it('auto-picks the single workspace when only one exists', async () => {
    const workspace = createTestWorkspace({ id: 'only-ws', name: 'only' });
    const config = createWorkspaceConfig();
    setActiveWorkspaceStore(createFakeStore([workspace]));
    readWorkspaceConfigFromHubMock.mockResolvedValue(config);

    const result = await loadWorkspace();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.workspaceId).toBe('only-ws');
    }
  });
});
