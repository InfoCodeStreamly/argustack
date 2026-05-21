import type { CodeSymbolKind } from '../types/code.js';

export interface EmbedChunkInput {
  content: string;
  kind: CodeSymbolKind;
}

export interface RerankDoc {
  id: string;
  content: string;
}

export interface RerankResult {
  id: string;
  score: number;
}

/**
 * Port: Code Embedding — vectors + reranking for code chunks.
 *
 * Intentionally NOT extends `IEmbeddingProvider`: the existing OpenAI port
 * uses 1536 dimensions for issue text, while voyage-code-3 uses 1024 for code.
 * A shared `readonly dimensions: number` would conflict.
 *
 * Backed by Voyage AI (voyage-code-3 + rerank-2.5-lite) in production.
 *
 * @throws Error when the API is unreachable or rate-limited beyond retry budget.
 */
export interface ICodeEmbedding {
  readonly name: string;
  readonly dimensions: number;

  /**
   * Embed code chunks for indexing. Uses `input_type='document'` upstream.
   * Order of returned vectors matches order of input chunks.
   */
  embedCode(chunks: EmbedChunkInput[]): Promise<number[][]>;

  /**
   * Embed a single natural-language query. Uses `input_type='query'` upstream.
   */
  embedQuery(query: string): Promise<number[]>;

  /**
   * Rerank candidate documents against a query. Returns topK by relevance.
   */
  rerank(
    query: string,
    docs: RerankDoc[],
    topK: number,
  ): Promise<RerankResult[]>;
}
