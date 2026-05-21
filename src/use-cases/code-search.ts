import type { ICodeGraph } from '../core/ports/code-graph.js';
import type { ICodeVectorStore } from '../core/ports/code-vector-store.js';
import type { ICodeEmbedding } from '../core/ports/code-embedding.js';
import type {
  CodeSymbolKind,
  CodeLayer,
  PlanFeatureFilesResult,
  PlannedFile,
  SemanticHit,
} from '../core/types/code.js';
import { HybridRanker, type RankerHit } from '../code-intel/ranker.js';

export interface SearchSemanticInput {
  projectId: string;
  query: string;
  layer?: CodeLayer;
  kind?: CodeSymbolKind;
  topK?: number;
}

export interface ExplainFeatureInput {
  projectId: string;
  query: string;
  topK?: number;
}

export interface PlanFeatureFilesInput {
  projectId: string;
  description: string;
  topKPerLayer?: number;
}

export class CodeSearchUseCase {
  private readonly ranker = new HybridRanker();

  constructor(
    private readonly graph: ICodeGraph,
    private readonly vec: ICodeVectorStore,
    private readonly embedding: ICodeEmbedding,
  ) {}

  async searchSemantic(input: SearchSemanticInput): Promise<RankerHit[]> {
    const topK = input.topK ?? 10;
    const vector = await this.embedding.embedQuery(input.query);
    const searchOpts: Parameters<ICodeVectorStore['searchSemantic']>[2] = {
      topK: Math.max(topK * 5, 30),
    };
    if (input.layer) {searchOpts.layer = input.layer;}
    if (input.kind) {searchOpts.kind = input.kind;}
    const candidates = await this.vec.searchSemantic(input.projectId, vector, searchOpts);
    return this.ranker.rankSemantic(input.query, candidates, this.embedding, topK);
  }

  async explainFeature(input: ExplainFeatureInput): Promise<{
    byLayer: Record<CodeLayer | 'unclassified', RankerHit[]>;
    expandedFiles: string[];
  }> {
    const topK = input.topK ?? 10;
    const vector = await this.embedding.embedQuery(input.query);
    const candidates = await this.vec.searchSemantic(input.projectId, vector, { topK: 50 });
    const reranked = await this.ranker.rankSemantic(
      input.query,
      candidates,
      this.embedding,
      topK,
    );
    const neighborhood = await this.ranker.expandGraph(
      this.graph,
      input.projectId,
      reranked.map((h) => h.symbolId),
      1,
    );
    return {
      byLayer: this.ranker.clusterByLayer(reranked),
      expandedFiles: Array.from(neighborhood.files),
    };
  }

  async planFeatureFiles(
    input: PlanFeatureFilesInput,
  ): Promise<PlanFeatureFilesResult> {
    const topKPerLayer = input.topKPerLayer ?? 5;
    const vector = await this.embedding.embedQuery(input.description);
    const candidates = await this.vec.searchSemantic(input.projectId, vector, {
      topK: 50,
    });
    const reranked = await this.ranker.rankSemantic(
      input.description,
      candidates,
      this.embedding,
      30,
    );
    const grouped = this.ranker.clusterByLayer(reranked);

    return {
      domain: pickFiles(grouped.domain, topKPerLayer),
      application: pickFiles(grouped.application, topKPerLayer),
      infrastructure: pickFiles(grouped.infrastructure, topKPerLayer),
      presentation: pickFiles(grouped.presentation, topKPerLayer),
    };
  }
}

function pickFiles(hits: SemanticHit[], limit: number): PlannedFile[] {
  const seen = new Set<string>();
  const out: PlannedFile[] = [];
  for (const hit of hits) {
    if (seen.has(hit.payload.filePath)) {continue;}
    seen.add(hit.payload.filePath);
    out.push({
      filePath: hit.payload.filePath,
      reason: `Matches '${hit.payload.name}' (${hit.payload.kind})`,
      similarTo: hit.payload.name,
      score: hit.score,
    });
    if (out.length >= limit) {break;}
  }
  return out;
}
