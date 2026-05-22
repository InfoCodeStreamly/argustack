import { describe, it, expect, beforeEach, vi } from 'vitest';

type RunFn = (cypher: string, params?: Record<string, unknown>) => Promise<{ records: unknown[] }>;

const hoisted = vi.hoisted(() => {
  const run = vi.fn<RunFn>();
  const close = vi.fn();
  const verify = vi.fn().mockResolvedValue(undefined);
  const driverClose = vi.fn().mockResolvedValue(undefined);
  const session = vi.fn(() => ({ run, close }));
  return { run, close, verify, driverClose, session };
});
const mockRun = hoisted.run;
const mockClose = hoisted.close;
const mockDriverClose = hoisted.driverClose;

vi.mock('neo4j-driver', () => {
  const intFn = (n: number): unknown => ({ low: n, high: 0 });
  return {
    default: {
      driver: vi.fn(() => ({
        session: hoisted.session,
        verifyConnectivity: hoisted.verify,
        close: hoisted.driverClose,
      })),
      auth: { basic: vi.fn(() => ({})) },
      int: intFn,
    },
  };
});

import { Neo4jCodeGraphStore } from '../../../../src/adapters/neo4j/index.js';
import { createCodeProject, CODE_TEST_IDS } from '../../../fixtures/shared/test-constants.js';

beforeEach(() => {
  mockRun.mockReset();
  mockRun.mockResolvedValue({ records: [] });
  mockClose.mockReset();
  mockClose.mockResolvedValue(undefined);
});

function runCall(index: number): { cypher: string; params: Record<string, unknown> } {
  const call = mockRun.mock.calls[index];
  if (call === undefined) {
    throw new Error(`mockRun has no call at index ${String(index)}`);
  }
  const [cypher, params] = call;
  return { cypher, params: params ?? {} };
}

describe('Neo4jCodeGraphStore', () => {
  const config = { uri: 'bolt://localhost:7687', user: 'neo4j', password: 'x' };

  it('initialize runs all CONSTRAINTS', async () => {
    const store = new Neo4jCodeGraphStore(config);
    await store.initialize();

    expect(mockRun).toHaveBeenCalledTimes(6); // CONSTRAINTS.length
    expect(mockRun.mock.calls[0]?.[0]).toContain('CREATE CONSTRAINT code_project_id');
  });

  it('ensureProject MERGEs project node', async () => {
    const store = new Neo4jCodeGraphStore(config);
    const project = createCodeProject();
    await store.ensureProject(project);

    const { cypher, params } = runCall(0);
    expect(cypher).toContain('MERGE (p:Project {id: $id})');
    expect(params).toMatchObject({ id: project.id, name: project.name });
  });

  it('findSymbol passes through projectId + query + limit', async () => {
    const store = new Neo4jCodeGraphStore(config);
    await store.findSymbol({ projectId: CODE_TEST_IDS.projectA, query: 'Store', limit: 5 });

    const { cypher, params } = runCall(0);
    expect(cypher).toContain('CONTAINS toLower($query)');
    expect(params['projectId']).toBe(CODE_TEST_IDS.projectA);
    expect(params['query']).toBe('Store');
    expect(params['limit']).toMatchObject({ low: 5, high: 0 });
  });

  it('getCallers wraps depth in neo4j.int', async () => {
    const store = new Neo4jCodeGraphStore(config);
    await store.getCallers(CODE_TEST_IDS.projectA, 'A.fn', 3);

    const { params } = runCall(0);
    expect(params['qn']).toBe('A.fn');
    expect(params['projectId']).toBe(CODE_TEST_IDS.projectA);
    expect(params['maxRows']).toMatchObject({ low: 1000, high: 0 });
  });

  it('getCallPath returns null when no records', async () => {
    mockRun.mockResolvedValueOnce({ records: [] });
    const store = new Neo4jCodeGraphStore(config);
    const path = await store.getCallPath(CODE_TEST_IDS.projectA, 'A', 'B');
    expect(path).toBeNull();
  });

  it('deleteProject sends DETACH DELETE cascade', async () => {
    const store = new Neo4jCodeGraphStore(config);
    await store.deleteProject(CODE_TEST_IDS.projectA);

    const { cypher, params } = runCall(0);
    expect(cypher).toContain('DETACH DELETE');
    expect(params['projectId']).toBe(CODE_TEST_IDS.projectA);
  });

  it('upsertFiles batches in chunks of 500', async () => {
    const files = Array.from({ length: 1200 }, (_, i) => ({
      projectId: CODE_TEST_IDS.projectA,
      path: `src/f${String(i)}.ts`,
      language: 'typescript' as const,
      layer: 'domain' as const,
      hash: `h${String(i)}`,
    }));

    const store = new Neo4jCodeGraphStore(config);
    await store.upsertFiles(CODE_TEST_IDS.projectA, files);

    // 1200 / 500 = 3 batches
    expect(mockRun).toHaveBeenCalledTimes(3);
  });

  it('replaceFileSymbols first DELETEs old symbols then MERGEs new', async () => {
    const store = new Neo4jCodeGraphStore(config);
    await store.replaceFileSymbols(CODE_TEST_IDS.projectA, 'src/A.ts', [
      { projectId: CODE_TEST_IDS.projectA, qualifiedName: 'A.fn', name: 'fn', kind: 'function', filePath: 'src/A.ts', startLine: 1, endLine: 1 },
    ]);

    expect(mockRun.mock.calls[0]?.[0]).toContain('DETACH DELETE s');
    expect(mockRun.mock.calls[1]?.[0]).toContain('MERGE (s:Symbol');
  });

  it('close calls driver.close', async () => {
    const store = new Neo4jCodeGraphStore(config);
    await store.close();
    expect(mockDriverClose).toHaveBeenCalled();
  });
});
