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
   * Maximum Marginal Relevance reorder.
   *
   * Picks results that are both relevant (high rerank score) AND
   * different from each other (low file-path/name overlap with
   * already-picked). Prevents top-K from being five chunks of the
   * same class.
   *
   * `lambda` (0..1):
   *   - 1.0 = pure relevance (= original order)
   *   - 0.0 = pure diversity
   *   - 0.5..0.7 is the common sweet spot.
   */
  mmrReorder(hits: RankerHit[], lambda: number, limit: number): RankerHit[] {
    if (hits.length === 0) { return []; }
    const remaining = [...hits];
    const picked: RankerHit[] = [];
    while (picked.length < limit && remaining.length > 0) {
      let bestIdx = 0;
      let bestScore = -Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const cand = remaining[i];
        if (cand === undefined) { continue; }
        const relevance = cand.rerankScore ?? cand.score;
        const diversity = picked.length === 0
          ? 0
          : Math.max(...picked.map((p) => textOverlap(cand, p)));
        const mmr = lambda * relevance - (1 - lambda) * diversity;
        if (mmr > bestScore) {
          bestScore = mmr;
          bestIdx = i;
        }
      }
      const chosen = remaining.splice(bestIdx, 1)[0];
      if (chosen !== undefined) {
        picked.push(chosen);
      }
    }
    return picked;
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

/**
 * MMR diversity signal: 1.0 = same file & same name, 0.0 = totally
 * different. We weight file-path more heavily than name because two
 * methods of the same class often answer the same question.
 */
function textOverlap(a: RankerHit, b: RankerHit): number {
  const samePath = a.payload.filePath === b.payload.filePath ? 0.7 : 0;
  const sameName = a.payload.name === b.payload.name ? 0.3 : 0;
  return samePath + sameName;
}
