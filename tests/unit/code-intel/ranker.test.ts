import { describe, it, expect } from 'vitest';
import { HybridRanker } from '../../../src/code-intel/ranker.js';
import { FakeCodeGraph } from '../../fixtures/fakes/fake-code-graph.js';
import { FakeCodeEmbedding } from '../../fixtures/fakes/fake-code-embedding.js';
import {
  createCallEdge,
  createCodeProject,
  createCodeSymbol,
  CODE_TEST_IDS,
} from '../../fixtures/shared/test-constants.js';
import type { SemanticHit } from '../../../src/core/types/code.js';

function hit(symbolId: string, score: number, content?: string): SemanticHit {
  return {
    symbolId,
    score,
    payload: {
      projectId: CODE_TEST_IDS.projectA,
      filePath: `src/${symbolId}.ts`,
      layer: symbolId.startsWith('dom') ? 'domain' : 'application',
      kind: 'function',
      name: symbolId,
      startLine: 1,
      endLine: 1,
      ...(content !== undefined ? { content } : {}),
    },
  };
}

describe('HybridRanker', () => {
  describe('rankSemantic', () => {
    it('reorders hits by rerank score and clips to topK', async () => {
      const ranker = new HybridRanker();
      const embedder = new FakeCodeEmbedding();
      const hits = [
        hit('alpha', 0.5, 'apple banana'),
        hit('beta', 0.4, 'banana cherry'),
        hit('gamma', 0.3, 'cherry date'),
      ];

      const ranked = await ranker.rankSemantic('apple cherry', hits, embedder, 2);

      expect(ranked).toHaveLength(2);
      expect(embedder.rerankCalls).toHaveLength(1);
    });

    it('returns top-K unchanged when input is empty', async () => {
      const ranker = new HybridRanker();
      const embedder = new FakeCodeEmbedding();
      const ranked = await ranker.rankSemantic('q', [], embedder, 5);
      expect(ranked).toEqual([]);
    });
  });

  describe('expandGraph', () => {
    it('returns union of callers + callees for seed ids', async () => {
      const graph = new FakeCodeGraph();
      graph.seed({
        projects: [createCodeProject()],
        symbols: [
          createCodeSymbol({ qualifiedName: 'A.caller', name: 'caller', filePath: 'src/A.ts' }),
          createCodeSymbol({ qualifiedName: 'A.seed', name: 'seed', filePath: 'src/A.ts' }),
          createCodeSymbol({ qualifiedName: 'A.callee', name: 'callee', filePath: 'src/A.ts' }),
        ],
        calls: [
          createCallEdge({ fromQn: 'A.caller', toQn: 'A.seed', count: 1 }),
          createCallEdge({ fromQn: 'A.seed', toQn: 'A.callee', count: 1 }),
        ],
      });

      const ranker = new HybridRanker();
      const { symbolIds, files } = await ranker.expandGraph(
        graph,
        CODE_TEST_IDS.projectA,
        ['A.seed'],
        1,
      );

      expect(symbolIds.has('A.seed')).toBe(true);
      expect(symbolIds.has('A.caller')).toBe(true);
      expect(symbolIds.has('A.callee')).toBe(true);
      expect(files.has('src/A.ts')).toBe(true);
    });
  });

  describe('clusterByLayer', () => {
    it('groups hits by layer + unclassified bucket', () => {
      const ranker = new HybridRanker();
      const grouped = ranker.clusterByLayer([
        hit('dom1', 0.9),
        hit('dom2', 0.8),
        hit('app1', 0.7),
      ]);

      expect(grouped.domain).toHaveLength(2);
      expect(grouped.application).toHaveLength(1);
      expect(grouped.infrastructure).toHaveLength(0);
      expect(grouped.presentation).toHaveLength(0);
      expect(grouped.unclassified).toHaveLength(0);
    });

    it('routes hits with layer=null into unclassified', () => {
      const ranker = new HybridRanker();
      const h: SemanticHit = {
        symbolId: 'x',
        score: 1,
        payload: {
          projectId: CODE_TEST_IDS.projectA,
          filePath: 'src/x.ts',
          layer: null,
          kind: 'function',
          name: 'x',
          startLine: 1,
          endLine: 1,
        },
      };
      const grouped = ranker.clusterByLayer([h]);
      expect(grouped.unclassified).toHaveLength(1);
    });
  });
});
