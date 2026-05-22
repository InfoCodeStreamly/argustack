/**
 * Unit tests for {@link PostgresQueryStorage} and the
 * {@link assertWorkspaceScoped} guard.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type pg from 'pg';
import {
  PostgresQueryStorage,
  assertWorkspaceScoped,
} from '../../../../src/adapters/postgres/storage-query.js';
import { TEST_IDS } from '../../../fixtures/shared/test-constants.js';

const WS = 'ws-test';

let pool: { query: ReturnType<typeof vi.fn>; };
let storage: PostgresQueryStorage;

beforeEach(() => {
  pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
  storage = new PostgresQueryStorage(pool as unknown as pg.Pool);
});

describe('assertWorkspaceScoped', () => {
  it('passes when SQL touches no tenant table', () => {
    expect(() => { assertWorkspaceScoped('SELECT 1'); }).not.toThrow();
  });

  it('passes when SQL touches a tenant table with workspace_id predicate', () => {
    expect(() => {
      assertWorkspaceScoped('SELECT issue_key FROM issues WHERE workspace_id = $1');
    }).not.toThrow();
  });

  it('throws when SQL touches a tenant table without workspace_id predicate', () => {
    expect(() => {
      assertWorkspaceScoped('SELECT issue_key FROM issues');
    }).toThrow(/tenant table without a workspace_id predicate/);
  });

  it('catches each known tenant table (issues, commits, pull_requests, graph_entities, db_tables, code_files)', () => {
    for (const table of ['issues', 'commits', 'pull_requests', 'graph_entities', 'db_tables', 'code_files']) {
      expect(() => { assertWorkspaceScoped(`SELECT * FROM ${table}`); }).toThrow();
    }
  });

  it('is case-insensitive', () => {
    expect(() => { assertWorkspaceScoped('SELECT * FROM ISSUES'); }).toThrow();
  });
});

describe('PostgresQueryStorage.queryForWorkspace', () => {
  it('binds workspaceId as the first parameter ($1)', async () => {
    await storage.queryForWorkspace(WS, 'SELECT * FROM issues WHERE workspace_id = $1', []);

    const [, params] = pool.query.mock.calls[0] as [string, unknown[]];
    expect(params[0]).toBe(WS);
  });

  it('appends caller params after workspaceId', async () => {
    await storage.queryForWorkspace(WS, 'SELECT * FROM issues WHERE workspace_id = $1 AND status = $2', ['Done']);

    const [, params] = pool.query.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([WS, 'Done']);
  });

  it('refuses SQL that touches a tenant table without workspace_id predicate', async () => {
    await expect(
      storage.queryForWorkspace(WS, 'SELECT * FROM issues', []),
    ).rejects.toThrow(/tenant table without a workspace_id predicate/);

    expect(pool.query).not.toHaveBeenCalled();
  });

  it('returns rows from pg.Pool wrapped as QueryResult', async () => {
    pool.query.mockResolvedValue({ rows: [{ issue_key: TEST_IDS.issueKey }] });

    const result = await storage.queryForWorkspace(WS, 'SELECT * FROM issues WHERE workspace_id = $1', []);

    expect(result.rows).toEqual([{ issue_key: TEST_IDS.issueKey }]);
  });
});

describe('PostgresQueryStorage.rawQuery', () => {
  it('runs SQL without injecting workspaceId', async () => {
    await storage.rawQuery('SELECT version()', []);

    const [, params] = pool.query.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([]);
  });

  it('allows SQL that touches tenant tables (admin escape hatch)', async () => {
    await expect(
      storage.rawQuery('SELECT * FROM issues', []),
    ).resolves.toBeDefined();
  });
});
