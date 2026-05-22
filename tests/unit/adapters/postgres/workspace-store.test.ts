/**
 * Unit tests for `PostgresWorkspaceStore` — the IWorkspaceStore adapter.
 *
 * The pg.Pool is mocked. `ensureSchema` (called from `initialize`) is
 * mocked at the module boundary so the adapter under test never issues
 * real DDL.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type pg from 'pg';
import type { Workspace } from '../../../../src/core/types/workspace.js';
import type { PostgresWorkspaceStore as PostgresWorkspaceStoreType } from '../../../../src/adapters/postgres/workspace-store.js';

interface MockPool {
  query: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
}

const ensureSchemaMock = vi.fn(async () => Promise.resolve());

vi.mock('../../../../src/adapters/postgres/schema.js', () => ({
  ensureSchema: ensureSchemaMock,
}));

let PostgresWorkspaceStore: new (pool: pg.Pool) => PostgresWorkspaceStoreType;
let mockPool: MockPool;

beforeEach(async () => {
  vi.clearAllMocks();
  ensureSchemaMock.mockResolvedValue(undefined);
  mockPool = {
    query: vi.fn(),
    end: vi.fn().mockResolvedValue(undefined),
  };
  const mod = await import('../../../../src/adapters/postgres/workspace-store.js');
  PostgresWorkspaceStore = mod.PostgresWorkspaceStore;
});

function createStore(): PostgresWorkspaceStoreType {
  return new PostgresWorkspaceStore(mockPool as unknown as pg.Pool);
}

function rowFor(
  workspace: Workspace,
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    id: workspace.id,
    name: workspace.name,
    display_name: workspace.displayName ?? null,
    settings: workspace.settings ?? {},
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    last_active_at: new Date('2026-05-01T00:00:00.000Z'),
    ...overrides,
  };
}

function lastQuery(): { sql: string; params: unknown[] } {
  const call = mockPool.query.mock.calls[0];
  if (call === undefined) {
    throw new Error('expected at least one query call');
  }
  const [sql, params] = call as [string, unknown[] | undefined];
  return { sql, params: params ?? [] };
}

describe('PostgresWorkspaceStore', () => {
  describe('initialize', () => {
    it('delegates to ensureSchema with the pool', async () => {
      const store = createStore();

      await store.initialize();

      expect(ensureSchemaMock).toHaveBeenCalledOnce();
      expect(ensureSchemaMock).toHaveBeenCalledWith(mockPool);
    });
  });

  describe('create', () => {
    it('rejects ids that do not match the slug pattern', async () => {
      const store = createStore();

      await expect(store.create({ id: 'BadId', name: 'x' })).rejects.toThrow(/lowercase kebab-case/);
    });

    it('rejects empty names', async () => {
      const store = createStore();

      await expect(store.create({ id: 'demo', name: '' })).rejects.toThrow(/name is required/);
    });

    it('returns the row with ISO timestamps and merged settings', async () => {
      const store = createStore();
      const ws: Workspace = { id: 'demo', name: 'demo', displayName: 'Demo' };
      mockPool.query.mockResolvedValueOnce({ rows: [rowFor(ws)] });

      const result = await store.create(ws);

      expect(result.id).toBe('demo');
      expect(result.displayName).toBe('Demo');
      expect(result.createdAt).toBe('2026-01-01T00:00:00.000Z');
      expect(result.lastActiveAt).toBe('2026-05-01T00:00:00.000Z');
    });

    it('issues UPSERT into workspaces with JSONB settings payload', async () => {
      const store = createStore();
      const ws: Workspace = { id: 'demo', name: 'demo', settings: { jiraProjectKeys: ['ARG'] } };
      mockPool.query.mockResolvedValueOnce({ rows: [rowFor(ws)] });

      await store.create(ws);

      const { sql, params } = lastQuery();
      expect(sql).toMatch(/INSERT INTO workspaces/);
      expect(sql).toMatch(/ON CONFLICT \(id\) DO UPDATE/);
      expect(params[0]).toBe('demo');
      expect(params[1]).toBe('demo');
      expect(params[3]).toBe(JSON.stringify({ jiraProjectKeys: ['ARG'] }));
    });

    it('throws when the DB returns no row', async () => {
      const store = createStore();
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await expect(store.create({ id: 'demo', name: 'demo' })).rejects.toThrow(/Failed to create workspace/);
    });
  });

  describe('getById', () => {
    it('returns null when no row is found', async () => {
      const store = createStore();
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const result = await store.getById('missing');

      expect(result).toBeNull();
    });

    it('maps a row into a Workspace shape', async () => {
      const store = createStore();
      mockPool.query.mockResolvedValueOnce({
        rows: [rowFor({ id: 'demo', name: 'demo', displayName: 'Demo' })],
      });

      const result = await store.getById('demo');

      expect(result?.id).toBe('demo');
      expect(result?.displayName).toBe('Demo');
    });

    it('omits displayName when stored as null', async () => {
      const store = createStore();
      mockPool.query.mockResolvedValueOnce({
        rows: [rowFor({ id: 'demo', name: 'demo' }, { display_name: null })],
      });

      const result = await store.getById('demo');

      expect(result?.displayName).toBeUndefined();
    });
  });

  describe('getByName', () => {
    it('queries by the name column', async () => {
      const store = createStore();
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await store.getByName('demo');

      const { sql, params } = lastQuery();
      expect(sql).toMatch(/WHERE name = \$1/);
      expect(params[0]).toBe('demo');
    });
  });

  describe('list', () => {
    it('orders by last_active_at DESC NULLS LAST', async () => {
      const store = createStore();
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await store.list();

      const { sql } = lastQuery();
      expect(sql).toMatch(/ORDER BY last_active_at DESC NULLS LAST, created_at DESC NULLS LAST/);
    });

    it('maps every row', async () => {
      const store = createStore();
      mockPool.query.mockResolvedValueOnce({
        rows: [
          rowFor({ id: 'a', name: 'a' }),
          rowFor({ id: 'b', name: 'b' }),
        ],
      });

      const result = await store.list();

      expect(result.map((w) => w.id)).toEqual(['a', 'b']);
    });
  });

  describe('updateSettings', () => {
    it('issues UPDATE with JSONB merge expression', async () => {
      const store = createStore();
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await store.updateSettings('demo', { jiraProjectKeys: ['ARG'] });

      const { sql, params } = lastQuery();
      expect(sql).toMatch(/UPDATE workspaces/);
      expect(sql).toMatch(/COALESCE\(settings, '\{\}'::jsonb\) \|\| \$2::jsonb/);
      expect(params[0]).toBe('demo');
      expect(params[1]).toBe(JSON.stringify({ jiraProjectKeys: ['ARG'] }));
    });
  });

  describe('remove', () => {
    it('issues DELETE on the workspaces table', async () => {
      const store = createStore();
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await store.remove('demo');

      const { sql, params } = lastQuery();
      expect(sql).toMatch(/DELETE FROM workspaces WHERE id = \$1/);
      expect(params[0]).toBe('demo');
    });
  });

  describe('touchActive', () => {
    it('issues UPDATE setting last_active_at to NOW()', async () => {
      const store = createStore();
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await store.touchActive('demo');

      const { sql, params } = lastQuery();
      expect(sql).toMatch(/UPDATE workspaces SET last_active_at = NOW\(\) WHERE id = \$1/);
      expect(params[0]).toBe('demo');
    });
  });

  describe('close', () => {
    it('ends the underlying pool', async () => {
      const store = createStore();

      await store.close();

      expect(mockPool.end).toHaveBeenCalledOnce();
    });
  });
});
