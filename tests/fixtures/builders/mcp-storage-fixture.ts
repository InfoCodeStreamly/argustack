import { vi, type Mock } from 'vitest';
import type { IStorage, QueryResult } from '../../../src/core/ports/storage.js';
import type {
  HybridSearchResult,
  GraphObservation,
  GraphQueryResult,
  GraphStats,
} from '../../../src/core/types/index.js';

/**
 * Test fixture: in-memory {@link IStorage} for MCP tool unit tests.
 *
 * Why this exists
 * ---------------
 * Production storage takes `workspaceId` as the first parameter of every
 * tenant-scoped method. MCP tools always pass the workspace id resolved
 * from {@link loadWorkspace}, so asserting it again in every test bloats
 * `.mock.calls` tuples without adding signal.
 *
 * This fixture implements {@link IStorage} for real (so it can be passed
 * to production code without casts), but exposes a parallel set of
 * "logical" spies that record only the *business* arguments — the SQL
 * the tool emitted, the limit it asked for, etc.
 *
 *   const storage = createMockMcpStorage();
 *   storage.queryForWorkspaceSpy.mockResolvedValueOnce({ rows: [...] });
 *
 *   // …production code calls storage.queryForWorkspace('ws-id', sql, params)
 *
 *   const [sql, params] = storage.queryForWorkspaceSpy.mock.calls[0];
 *
 * The workspace id is verified separately via {@link lastWorkspaceId} —
 * one centralised assertion instead of N tuple destructures.
 */
export interface MockMcpStorage extends IStorage {
  /** Spy receiving `(sql, params)` from every `queryForWorkspace` call. */
  readonly queryForWorkspaceSpy: Mock<(sql: string, params: unknown[]) => Promise<QueryResult>>;
  /** Spy receiving `(sql, params)` from every `rawQuery` call. */
  readonly rawQuerySpy: Mock<(sql: string, params: unknown[]) => Promise<QueryResult>>;
  /** Spy receiving `(query, vector, limit, threshold?)` from every `hybridSearch` call. */
  readonly hybridSearchSpy: Mock<
    (
      query: string,
      vector: number[] | null,
      limit: number,
      threshold?: number,
    ) => Promise<HybridSearchResult[]>
  >;
  /** Spy receiving `(entityName, depth)` from every `queryGraph` call. */
  readonly queryGraphSpy: Mock<(entityName: string, depth: number) => Promise<GraphQueryResult>>;
  readonly getGraphStatsSpy: Mock<() => Promise<GraphStats>>;
  readonly getObservationsSpy: Mock<(entityId: number) => Promise<GraphObservation[]>>;
  readonly initializeSpy: Mock<() => Promise<void>>;
  readonly closeSpy: Mock<() => Promise<void>>;

  /** Last workspaceId observed by any tenant-scoped call, or `null` if none. */
  lastWorkspaceId(): string | null;
}

const unsupported = (method: string): never => {
  throw new Error(`MockMcpStorage.${method}() is not implemented for MCP tool tests`);
};

/**
 * Build a fresh `MockMcpStorage`. Each call returns independent spies.
 */
export function createMockMcpStorage(): MockMcpStorage {
  let observedWorkspaceId: string | null = null;

  const initializeSpy = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const closeSpy = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

  const queryForWorkspaceSpy: MockMcpStorage['queryForWorkspaceSpy'] = vi.fn();
  const rawQuerySpy: MockMcpStorage['rawQuerySpy'] = vi.fn();
  const hybridSearchSpy: MockMcpStorage['hybridSearchSpy'] = vi.fn();
  const queryGraphSpy: MockMcpStorage['queryGraphSpy'] = vi.fn();
  const getGraphStatsSpy: MockMcpStorage['getGraphStatsSpy'] = vi.fn();
  const getObservationsSpy: MockMcpStorage['getObservationsSpy'] = vi.fn();

  return {
    name: 'MockMcpStorage',
    initializeSpy,
    closeSpy,
    queryForWorkspaceSpy,
    rawQuerySpy,
    hybridSearchSpy,
    queryGraphSpy,
    getGraphStatsSpy,
    getObservationsSpy,

    lastWorkspaceId: () => observedWorkspaceId,

    initialize: async () => initializeSpy(),
    close: async () => closeSpy(),

    queryForWorkspace: async (workspaceId, sql, params) => {
      observedWorkspaceId = workspaceId;
      return queryForWorkspaceSpy(sql, params);
    },
    rawQuery: async (sql, params) => rawQuerySpy(sql, params),
    hybridSearch: async (workspaceId, query, vector, limit, threshold) => {
      observedWorkspaceId = workspaceId;
      return hybridSearchSpy(query, vector, limit, threshold);
    },
    queryGraph: async (workspaceId, entityName, depth) => {
      observedWorkspaceId = workspaceId;
      return queryGraphSpy(entityName, depth);
    },
    getGraphStats: async (workspaceId) => {
      observedWorkspaceId = workspaceId;
      return getGraphStatsSpy();
    },
    getObservations: async (workspaceId, entityId) => {
      observedWorkspaceId = workspaceId;
      return getObservationsSpy(entityId);
    },

    saveBatch: () => unsupported('saveBatch'),
    saveCommitBatch: () => unsupported('saveCommitBatch'),
    getLastUpdated: () => unsupported('getLastUpdated'),
    getLastCommitDate: () => unsupported('getLastCommitDate'),
    saveGitHubBatch: () => unsupported('saveGitHubBatch'),
    saveReleases: () => unsupported('saveReleases'),
    getLastPrUpdated: () => unsupported('getLastPrUpdated'),
    getUnembeddedIssueKeys: () => unsupported('getUnembeddedIssueKeys'),
    saveEmbedding: () => unsupported('saveEmbedding'),
    semanticSearch: () => unsupported('semanticSearch'),
    saveDbSchemaBatch: () => unsupported('saveDbSchemaBatch'),
    deleteDbSchema: () => unsupported('deleteDbSchema'),
    getLocalIssues: () => unsupported('getLocalIssues'),
    updateIssueSource: () => unsupported('updateIssueSource'),
    updateIssueFields: () => unsupported('updateIssueFields'),
    getModifiedIssues: () => unsupported('getModifiedIssues'),
    clearModifiedFlag: () => unsupported('clearModifiedFlag'),
    saveGraphEntities: () => unsupported('saveGraphEntities'),
    saveGraphRelationships: () => unsupported('saveGraphRelationships'),
    saveGraphObservation: () => unsupported('saveGraphObservation'),
    clearGraph: () => unsupported('clearGraph'),
  };
}
