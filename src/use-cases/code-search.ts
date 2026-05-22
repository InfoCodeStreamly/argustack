import type { ICodeGraph } from '../core/ports/code-graph.js';
import type { ICodeVectorStore } from '../core/ports/code-vector-store.js';
import type { ICodeEmbedding } from '../core/ports/code-embedding.js';
import type { IChatLlm } from '../core/ports/chat-llm.js';
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

export interface FileBucket {
  filePath: string;
  layer: CodeLayer | null;
  bestScore: number;
  symbols: RankerHit[];
}

export interface ExplainFeatureResult {
  hypotheticalDoc: string | null;
  byLayer: Record<CodeLayer | 'unclassified', FileBucket[]>;
  expandedFiles: string[];
}

export interface PlanFeatureFilesInput {
  projectId: string;
  description: string;
  topKPerLayer?: number;
}

const HYDE_PROMPT = `You are a senior TypeScript engineer. The user asked about a feature in a hexagonal-architecture codebase (ports + adapters, use-cases, MCP tools).

Write a short, code-shaped answer in TypeScript pseudo-code that would likely appear in the codebase. Include:
- one or two class/interface names you'd expect to find
- 3-6 lines of code that illustrate the answer
- import-style identifiers like \`I<Something>\`, \`<Something>UseCase\`, \`<Something>Adapter\`

Do not explain. Just emit code-like text under 200 tokens.

Question: {{QUERY}}

Code:`;

export class CodeSearchUseCase {
  private readonly ranker = new HybridRanker();

  constructor(
    private readonly graph: ICodeGraph,
    private readonly vec: ICodeVectorStore,
    private readonly embedding: ICodeEmbedding,
    private readonly chatLlm: IChatLlm | null = null,
  ) {}

  async searchSemantic(input: SearchSemanticInput): Promise<RankerHit[]> {
    const topK = input.topK ?? 10;
    const vector = await this.embedding.embedQuery(input.query);
    const searchOpts: Parameters<ICodeVectorStore['searchSemantic']>[2] = {
      topK: Math.max(topK * 5, 30),
    };
    if (input.layer !== undefined) {searchOpts.layer = input.layer;}
    if (input.kind !== undefined) {searchOpts.kind = input.kind;}
    const candidates = await this.vec.searchSemantic(input.projectId, vector, searchOpts);
    return this.ranker.rankSemantic(input.query, candidates, this.embedding, topK);
  }

  /**
   * Explain a feature with a 3-stage pipeline:
   *   1. HyDE (optional, when chatLlm is wired): the LLM writes a
   *      "what code would answer this" sketch; we embed `query + sketch`
   *      for richer retrieval, then keep the raw query as the rerank
   *      probe so the model isn't fooled by hallucinated names.
   *   2. Wide retrieval → rerank → MMR diversity (per-file).
   *   3. Group hits by file (best symbol wins), then by layer.
   *      Expand graph 2 hops for call-path coverage.
   *
   * Falls back gracefully to vector-only retrieval when `chatLlm` is
   * null or the LLM call returns an empty string.
   */
  async explainFeature(input: ExplainFeatureInput): Promise<ExplainFeatureResult> {
    const topK = input.topK ?? 10;

    const hypotheticalDoc = await this.runHyDE(input.query);
    const retrievalQuery = hypotheticalDoc !== null && hypotheticalDoc.length > 0
      ? `${input.query}\n\n${hypotheticalDoc}`
      : input.query;
    const vector = await this.embedding.embedQuery(retrievalQuery);

    const candidates = await this.vec.searchSemantic(input.projectId, vector, { topK: 100 });
    const reranked = await this.ranker.rankSemantic(
      input.query,
      candidates,
      this.embedding,
      Math.max(topK * 3, 30),
    );
    const diversified = this.ranker.mmrReorder(reranked, 0.6, Math.max(topK * 2, 20));

    const fileBuckets = groupByFile(diversified, topK);

    const neighborhood = await this.ranker.expandGraph(
      this.graph,
      input.projectId,
      diversified.slice(0, topK).map((h) => h.symbolId),
      2,
    );
    const seedFiles = new Set(fileBuckets.map((b) => b.filePath));
    const expandedFiles = Array.from(neighborhood.files).filter((f) => !seedFiles.has(f));

    return {
      hypotheticalDoc,
      byLayer: clusterFilesByLayer(fileBuckets),
      expandedFiles,
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

  private async runHyDE(query: string): Promise<string | null> {
    if (this.chatLlm === null) { return null; }
    try {
      const prompt = HYDE_PROMPT.replace('{{QUERY}}', query);
      const reply = await this.chatLlm.generate(prompt, {
        maxTokens: 256,
        temperature: 0.2,
        timeoutMs: 15_000,
      });
      return reply.length > 0 ? reply : null;
    } catch {
      return null;
    }
  }
}

function groupByFile(hits: RankerHit[], limit: number): FileBucket[] {
  const byFile = new Map<string, FileBucket>();
  for (const hit of hits) {
    const existing = byFile.get(hit.payload.filePath);
    if (existing === undefined) {
      byFile.set(hit.payload.filePath, {
        filePath: hit.payload.filePath,
        layer: hit.payload.layer,
        bestScore: hit.rerankScore ?? hit.score,
        symbols: [hit],
      });
      continue;
    }
    existing.symbols.push(hit);
    const score = hit.rerankScore ?? hit.score;
    if (score > existing.bestScore) {
      existing.bestScore = score;
    }
  }
  return [...byFile.values()]
    .sort((a, b) => b.bestScore - a.bestScore)
    .slice(0, limit);
}

function clusterFilesByLayer(
  buckets: FileBucket[],
): Record<CodeLayer | 'unclassified', FileBucket[]> {
  const out: Record<CodeLayer | 'unclassified', FileBucket[]> = {
    domain: [],
    application: [],
    infrastructure: [],
    presentation: [],
    unclassified: [],
  };
  for (const b of buckets) {
    out[b.layer ?? 'unclassified'].push(b);
  }
  return out;
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
