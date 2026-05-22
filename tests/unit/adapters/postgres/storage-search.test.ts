/**
 * Unit tests for {@link PostgresSearchStorage} — vector + hybrid search.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type pg from 'pg';
import { PostgresSearchStorage } from '../../../../src/adapters/postgres/storage-search.js';
import { TEST_IDS } from '../../../fixtures/shared/test-constants.js';

const WS = 'ws-test';

let pool: { query: ReturnType<typeof vi.fn>; };
let storage: PostgresSearchStorage;

beforeEach(() => {
  pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
  storage = new PostgresSearchStorage(pool as unknown as pg.Pool);
});

describe('getUnembeddedIssueKeys', () => {
  it('returns issue_keys where embedding IS NULL', async () => {
    pool.query.mockResolvedValue({ rows: [{ issue_key: TEST_IDS.issueKey }, { issue_key: TEST_IDS.issueKey2 }] });

    const keys = await storage.getUnembeddedIssueKeys(WS, 100);

    expect(keys).toEqual([TEST_IDS.issueKey, TEST_IDS.issueKey2]);
    const [sql] = pool.query.mock.calls[0] as [string];
    expect(sql).toContain('embedding IS NULL');
  });

  it('respects the limit parameter', async () => {
    pool.query.mockResolvedValue({ rows: [] });

    await storage.getUnembeddedIssueKeys(WS, 5);

    const [, params] = pool.query.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([WS, 5]);
  });
});

describe('saveEmbedding', () => {
  it('serialises vector as pgvector literal "[v1,v2,v3]"', async () => {
    await storage.saveEmbedding(WS, TEST_IDS.issueKey, [0.1, 0.2, 0.3]);

    const [, params] = pool.query.mock.calls[0] as [string, unknown[]];
    expect(params[0]).toBe('[0.1,0.2,0.3]');
    expect(params[1]).toBe(WS);
    expect(params[2]).toBe(TEST_IDS.issueKey);
  });
});

describe('semanticSearch', () => {
  it('returns issueKey + similarity rows', async () => {
    pool.query.mockResolvedValue({
      rows: [{ issue_key: TEST_IDS.issueKey, similarity: 0.95 }, { issue_key: TEST_IDS.issueKey2, similarity: 0.7 }],
    });

    const result = await storage.semanticSearch(WS, [0.1, 0.2], 10);

    expect(result).toEqual([
      { issueKey: TEST_IDS.issueKey, similarity: 0.95 },
      { issueKey: TEST_IDS.issueKey2, similarity: 0.7 },
    ]);
  });

  it('adds threshold clause when threshold is provided', async () => {
    pool.query.mockResolvedValue({ rows: [] });

    await storage.semanticSearch(WS, [0.1], 10, 0.8);

    const [sql] = pool.query.mock.calls[0] as [string];
    expect(sql).toContain('AND 1 - (embedding <=> $2::vector) >= 0.8');
  });

  it('omits threshold clause when threshold is undefined', async () => {
    pool.query.mockResolvedValue({ rows: [] });

    await storage.semanticSearch(WS, [0.1], 10);

    const [sql] = pool.query.mock.calls[0] as [string];
    expect(sql).not.toContain('>=');
  });
});

describe('hybridSearch', () => {
  it('runs text-only path when vector is null', async () => {
    pool.query.mockResolvedValue({
      rows: [{ issue_key: TEST_IDS.issueKey, score: 0.05, in_text: true, in_vector: false }],
    });

    const result = await storage.hybridSearch(WS, 'query', null, 10);

    expect(result).toEqual([{ issueKey: TEST_IDS.issueKey, score: 0.05, source: 'text' }]);
    const [sql] = pool.query.mock.calls[0] as [string];
    expect(sql).not.toContain('vector_search');
  });

  it('runs RRF hybrid path when vector is provided', async () => {
    pool.query.mockResolvedValue({
      rows: [
        { issue_key: TEST_IDS.issueKey, score: 0.05, in_text: true, in_vector: true },
        { issue_key: TEST_IDS.issueKey2, score: 0.03, in_text: true, in_vector: false },
        { issue_key: TEST_IDS.issueKey3, score: 0.02, in_text: false, in_vector: true },
      ],
    });

    const result = await storage.hybridSearch(WS, 'query', [0.1, 0.2], 10);

    expect(result.map((r) => r.source)).toEqual(['both', 'text', 'semantic']);
  });

  it('uses default threshold 0.5 when not provided', async () => {
    pool.query.mockResolvedValue({ rows: [] });

    await storage.hybridSearch(WS, 'query', [0.1], 10);

    const [sql] = pool.query.mock.calls[0] as [string];
    expect(sql).toContain('>= 0.5');
  });
});
