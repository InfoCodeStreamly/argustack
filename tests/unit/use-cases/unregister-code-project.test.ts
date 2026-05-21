import { describe, it, expect } from 'vitest';
import { UnregisterCodeProjectUseCase } from '../../../src/use-cases/unregister-code-project.js';
import { FakeCodeGraph } from '../../fixtures/fakes/fake-code-graph.js';
import { FakeCodeVectorStore } from '../../fixtures/fakes/fake-code-vector-store.js';
import { FakeCodeMetaStore } from '../../fixtures/fakes/fake-code-meta-store.js';
import { CODE_TEST_IDS, createCodeProject } from '../../fixtures/shared/test-constants.js';

describe('UnregisterCodeProjectUseCase (unit)', () => {
  it('removes from meta, graph, and vec', async () => {
    const meta = new FakeCodeMetaStore();
    const graph = new FakeCodeGraph();
    const vec = new FakeCodeVectorStore();
    await meta.registerProject(createCodeProject());
    await graph.ensureProject(createCodeProject());
    await vec.ensureCollection(CODE_TEST_IDS.projectA, 8);

    await new UnregisterCodeProjectUseCase(meta, graph, vec).execute(CODE_TEST_IDS.projectA);

    expect(meta.projects.has(CODE_TEST_IDS.projectA)).toBe(false);
    expect(graph.projects.has(CODE_TEST_IDS.projectA)).toBe(false);
    expect(vec.collections.has(CODE_TEST_IDS.projectA)).toBe(false);
  });

  it('tolerates already-deleted Qdrant collection', async () => {
    const meta = new FakeCodeMetaStore();
    const graph = new FakeCodeGraph();
    const vec = new FakeCodeVectorStore();
    await meta.registerProject(createCodeProject());
    await expect(
      new UnregisterCodeProjectUseCase(meta, graph, vec).execute(CODE_TEST_IDS.projectA),
    ).resolves.not.toThrow();
  });
});
