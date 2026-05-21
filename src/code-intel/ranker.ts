import type { ICodeGraph } from '../core/ports/code-graph.js';
import type { ICodeEmbedding } from '../core/ports/code-embedding.js';
import type {
  CodeLayer,
  SemanticHit,
} from '../core/types/code.js';

export interface RankerHit extends SemanticHit {
  rerankScore?: number;
}

export interface ExpandedNeighborhood {
  symbolIds: Set<string>;
  files: Set<string>;
}

export class HybridRanker {
  /**
   * Second-stage rerank of candidate hits via voyage rerank.
   * Returns reordered hits, longest input first if rerank fails.
   */
  async rankSemantic(
    query: string,
    hits: SemanticHit[],
    embedder: ICodeEmbedding,
    topK: number,
  ): Promise<RankerHit[]> {
    if (hits.length === 0) {return [];}
    const docs = hits.map((h) => ({
      id: h.symbolId,
      content: h.payload.content ?? `${h.payload.name} (${h.payload.filePath})`,
    }));
    try {
      const reranked = await embedder.rerank(query, docs, topK);
      const scoreMap = new Map(reranked.map((r) => [r.id, r.score]));
      return hits
        .filter((h) => scoreMap.has(h.symbolId))
        .map<RankerHit>((h) => ({ ...h, rerankScore: scoreMap.get(h.symbolId) ?? 0 }))
        .sort((a, b) => (b.rerankScore ?? 0) - (a.rerankScore ?? 0))
        .slice(0, topK);
    } catch {
      return hits.slice(0, topK);
    }
  }

  /**
   * Expand graph neighborhood: callers + callees within `hops` of each seed symbol.
   */
  async expandGraph(
    graph: ICodeGraph,
    projectId: string,
    seedSymbolIds: string[],
    hops: number,
  ): Promise<ExpandedNeighborhood> {
    const symbolIds = new Set<string>(seedSymbolIds);
    const files = new Set<string>();
    for (const seed of seedSymbolIds) {
      const [callers, callees] = await Promise.all([
        graph.getCallers(projectId, seed, hops),
        graph.getCallees(projectId, seed, hops),
      ]);
      for (const c of callers) {
        symbolIds.add(c.qualifiedName);
        files.add(c.filePath);
      }
      for (const c of callees) {
        symbolIds.add(c.qualifiedName);
        files.add(c.filePath);
      }
    }
    return { symbolIds, files };
  }

  /**
   * Group ranker hits by Clean Architecture layer.
   * Hits with `layer === null` go into a separate `unclassified` bucket
   * via the empty-string key, which callers may discard.
   */
  clusterByLayer(hits: RankerHit[]): Record<CodeLayer | 'unclassified', RankerHit[]> {
    const empty: Record<CodeLayer | 'unclassified', RankerHit[]> = {
      domain: [],
      application: [],
      infrastructure: [],
      presentation: [],
      unclassified: [],
    };
    for (const hit of hits) {
      const layer = hit.payload.layer ?? 'unclassified';
      empty[layer].push(hit);
    }
    return empty;
  }
}
