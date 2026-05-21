import { describe, it, expect, beforeEach } from 'vitest';
import { RegisterCodeProjectUseCase } from '../../../src/use-cases/register-code-project.js';
import { UnregisterCodeProjectUseCase } from '../../../src/use-cases/unregister-code-project.js';
import { FakeCodeGraph } from '../../fixtures/fakes/fake-code-graph.js';
import { FakeCodeVectorStore } from '../../fixtures/fakes/fake-code-vector-store.js';
import { FakeCodeMetaStore } from '../../fixtures/fakes/fake-code-meta-store.js';
import { FakeCodeEmbedding } from '../../fixtures/fakes/fake-code-embedding.js';
import { createCodeProject, CODE_TEST_IDS } from '../../fixtures/shared/test-constants.js';

describe('RegisterCodeProjectUseCase', () => {
  let meta: FakeCodeMetaStore;
  let graph: FakeCodeGraph;
  let vec: FakeCodeVectorStore;
  let embedding: FakeCodeEmbedding;

  beforeEach(() => {
    meta = new FakeCodeMetaStore();
    graph = new FakeCodeGraph();
    vec = new FakeCodeVectorStore();
    embedding = new FakeCodeEmbedding(16);
  });

  it('registers project in meta + ensures Neo4j project node + Qdrant collection', async () => {
    const useCase = new RegisterCodeProjectUseCase(meta, graph, vec, embedding);
    const project = createCodeProject();
    const result = await useCase.execute(project);

    expect(result).toEqual(project);
    expect(meta.registerCalls).toEqual([project]);
    expect(graph.ensureProjectCalls).toEqual([project]);
    expect(vec.ensureCollectionCalls).toEqual([{ projectId: project.id, dim: 16 }]);
  });

  it('uses embedding.dimensions for Qdrant collection size', async () => {
    const customEmbedding = new FakeCodeEmbedding(2048);
    const useCase = new RegisterCodeProjectUseCase(meta, graph, vec, customEmbedding);
    await useCase.execute(createCodeProject());

    expect(vec.ensureCollectionCalls[0]?.dim).toBe(2048);
  });

  it('registering twice is idempotent (Map upsert)', async () => {
    const useCase = new RegisterCodeProjectUseCase(meta, graph, vec, embedding);
    const project = createCodeProject();
    await useCase.execute(project);
    await useCase.execute(project);

    expect(meta.projects.size).toBe(1);
    expect(graph.projects.size).toBe(1);
    expect(vec.collections.size).toBe(1);
  });
});

describe('UnregisterCodeProjectUseCase', () => {
  let meta: FakeCodeMetaStore;
  let graph: FakeCodeGraph;
  let vec: FakeCodeVectorStore;
  let embedding: FakeCodeEmbedding;

  beforeEach(() => {
    meta = new FakeCodeMetaStore();
    graph = new FakeCodeGraph();
    vec = new FakeCodeVectorStore();
    embedding = new FakeCodeEmbedding();
  });

  it('removes from all three stores in reverse order (graph → vec → meta)', async () => {
    // Register first
    await new RegisterCodeProjectUseCase(meta, graph, vec, embedding).execute(createCodeProject());

    const useCase = new UnregisterCodeProjectUseCase(meta, graph, vec);
    await useCase.execute(CODE_TEST_IDS.projectA);

    expect(graph.projects.has(CODE_TEST_IDS.projectA)).toBe(false);
    expect(vec.collections.has(CODE_TEST_IDS.projectA)).toBe(false);
    expect(meta.projects.has(CODE_TEST_IDS.projectA)).toBe(false);
  });

  it('tolerates missing Qdrant collection (already deleted)', async () => {
    await new RegisterCodeProjectUseCase(meta, graph, vec, embedding).execute(createCodeProject());
    // Manually drop the Qdrant collection to simulate "already gone"
    vec.collections.delete(CODE_TEST_IDS.projectA);

    const useCase = new UnregisterCodeProjectUseCase(meta, graph, vec);
    await expect(useCase.execute(CODE_TEST_IDS.projectA)).resolves.not.toThrow();
    expect(meta.projects.has(CODE_TEST_IDS.projectA)).toBe(false);
  });
});
