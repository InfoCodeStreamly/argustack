/**
 * Unit tests for {@link PostgresGraphStorage} — knowledge graph.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type pg from 'pg';
import { PostgresGraphStorage } from '../../../../src/adapters/postgres/storage-graph.js';
import type { GraphEntity, GraphRelationship } from '../../../../src/core/types/index.js';
import { TEST_IDS } from '../../../fixtures/shared/test-constants.js';

const WS = 'ws-test';

let pool: { query: ReturnType<typeof vi.fn>; };
let storage: PostgresGraphStorage;

beforeEach(() => {
  pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
  storage = new PostgresGraphStorage(pool as unknown as pg.Pool);
});

describe('saveGraphEntities', () => {
  it('upserts each entity with workspace_id+name+type as conflict key', async () => {
    const entities: GraphEntity[] = [
      { name: TEST_IDS.issueKey, type: 'issue', properties: { status: 'Open' } },
      { name: 'alice', type: 'developer', properties: {} },
    ];

    await storage.saveGraphEntities(WS, entities);

    expect(pool.query).toHaveBeenCalledTimes(2);
    const [sql] = pool.query.mock.calls[0] as [string];
    expect(sql).toContain('ON CONFLICT (workspace_id, name, type)');
  });

  it('serialises properties as JSON', async () => {
    await storage.saveGraphEntities(WS, [{ name: 'X', type: 'issue', properties: { a: 1 } }]);

    const [, params] = pool.query.mock.calls[0] as [string, unknown[]];
    expect(params[3]).toBe(JSON.stringify({ a: 1 }));
  });
});

describe('saveGraphRelationships', () => {
  it('upserts each relationship', async () => {
    const rels: GraphRelationship[] = [
      { sourceId: 1, targetId: 2, type: 'references', weight: 1, source: 'structural', properties: {} },
    ];

    await storage.saveGraphRelationships(WS, rels);

    const [sql] = pool.query.mock.calls[0] as [string];
    expect(sql).toContain('INSERT INTO graph_relationships');
    expect(sql).toContain('ON CONFLICT (workspace_id, source_id, target_id, type)');
  });
});

describe('saveGraphObservation + getObservations', () => {
  it('inserts an observation for an entity', async () => {
    await storage.saveGraphObservation(WS, 42, 'note', 'claude');

    const [, params] = pool.query.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([WS, 42, 'note', 'claude']);
  });

  it('returns observations mapped from rows', async () => {
    pool.query.mockResolvedValue({
      rows: [{ id: 1, entity_id: 42, content: 'note', author: 'claude', created_at: '2025-01-01' }],
    });

    const result = await storage.getObservations(WS, 42);

    expect(result).toEqual([{ id: 1, entityId: 42, content: 'note', author: 'claude', createdAt: '2025-01-01' }]);
  });
});

describe('queryGraph', () => {
  it('returns empty result when no entities match', async () => {
    pool.query.mockResolvedValue({ rows: [] });

    const result = await storage.queryGraph(WS, 'unknown', 2);

    expect(result.entities).toEqual([]);
    expect(result.relationships).toEqual([]);
    expect(result.observations).toEqual([]);
  });

  it('fetches relationships and observations for matched entities', async () => {
    pool.query
      .mockResolvedValueOnce({
        rows: [{ id: 1, name: TEST_IDS.issueKey, type: 'issue', properties: {} }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 10, source_id: 1, target_id: 2, type: 'refs', weight: 1, source: 'structural', properties: {} }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 100, entity_id: 1, content: 'n', author: 'claude', created_at: '2025-01-01' }],
      });

    const result = await storage.queryGraph(WS, 'PROJ', 2);

    expect(result.entities).toHaveLength(1);
    expect(result.relationships).toHaveLength(1);
    expect(result.observations).toHaveLength(1);
  });
});

describe('getGraphStats', () => {
  it('aggregates counts by entity/relationship type', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ type: 'issue', cnt: '5' }, { type: 'developer', cnt: '2' }] })
      .mockResolvedValueOnce({ rows: [{ type: 'refs', cnt: '10' }] })
      .mockResolvedValueOnce({ rows: [{ cnt: '3' }] });

    const stats = await storage.getGraphStats(WS);

    expect(stats.entityCount).toBe(7);
    expect(stats.relationshipCount).toBe(10);
    expect(stats.observationCount).toBe(3);
    expect(stats.byEntityType).toEqual({ issue: 5, developer: 2 });
    expect(stats.byRelationshipType).toEqual({ refs: 10 });
  });
});

describe('clearGraph', () => {
  it('deletes only structural/auto relationships, preserves claude-sourced', async () => {
    await storage.clearGraph(WS);

    const [sql] = pool.query.mock.calls[0] as [string];
    expect(sql).toContain("source IN ('structural', 'auto')");
  });
});
