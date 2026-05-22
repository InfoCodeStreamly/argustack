import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TEST_IDS } from '../../../fixtures/shared/test-constants.js';
import type { PostgresStorage as PostgresStorageType } from '../../../../src/adapters/postgres/storage.js';
import type { DbConfig } from '../../../../src/adapters/postgres/connection.js';

const mockPool = {
  query: vi.fn(),
  connect: vi.fn(),
  end: vi.fn(),
};

vi.mock('pg', () => {
  const MockPool = vi.fn(function (this: Record<string, unknown>) {
    Object.assign(this, mockPool);
  });
  return {
    default: { Pool: MockPool },
    Pool: MockPool,
  };
});

const TEST_DB_CONFIG: DbConfig = {
  host: 'localhost',
  port: 5434,
  user: 'argustack',
  password: 'argustack_local',
  database: 'argustack',
};

const TEST_WORKSPACE_ID = 'test-workspace';

let PostgresStorage: new (config: DbConfig) => PostgresStorageType;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('../../../../src/adapters/postgres/storage.js');
  PostgresStorage = mod.PostgresStorage;
});

function createStorage(): PostgresStorageType {
  return new PostgresStorage(TEST_DB_CONFIG);
}

describe('PostgresStorage', () => {
  describe('hybridSearch', () => {
    it('text-only mode when vector is null', async () => {
      const storage = createStorage();
      mockPool.query.mockResolvedValueOnce({
        rows: [{ issue_key: TEST_IDS.issueKey, score: 0.016, in_text: true, in_vector: false }],
      });
      const results = await storage.hybridSearch(TEST_WORKSPACE_ID, 'login bug', null, 10);
      expect(results).toHaveLength(1);
      expect(results[0]?.source).toBe('text');
    });

    it('hybrid mode with vector', async () => {
      const storage = createStorage();
      mockPool.query.mockResolvedValueOnce({
        rows: [
          { issue_key: TEST_IDS.issueKey, score: 0.032, in_text: true, in_vector: true },
          { issue_key: TEST_IDS.issueKey2, score: 0.016, in_text: false, in_vector: true },
        ],
      });
      const results = await storage.hybridSearch(TEST_WORKSPACE_ID, 'login', [0.1, 0.2], 10);
      expect(results).toHaveLength(2);
      expect(results[0]?.source).toBe('both');
      expect(results[1]?.source).toBe('semantic');
    });
  });

  describe('close', () => {
    it('ends the pool', async () => {
      const storage = createStorage();
      await storage.close();
      expect(mockPool.end).toHaveBeenCalled();
    });
  });
});
