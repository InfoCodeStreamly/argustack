import type {
  ICodeEmbedding,
  EmbedChunkInput,
  RerankDoc,
  RerankResult,
} from '../../core/ports/code-embedding.js';

export interface VoyageConfig {
  apiKey: string;
  model?: string;
  rerankModel?: string;
  dimensions?: number;
  batchSize?: number;
  maxRetries?: number;
}

interface VoyageEmbedRequest {
  input: string[];
  model: string;
  input_type: 'document' | 'query';
  output_dimension?: number;
}

interface VoyageEmbedResponse {
  data: { embedding: number[]; index: number }[];
  usage?: { total_tokens?: number };
}

interface VoyageRerankRequest {
  query: string;
  documents: string[];
  model: string;
  top_k?: number;
}

interface VoyageRerankResponse {
  data: { index: number; relevance_score: number }[];
}

const EMBED_URL = 'https://api.voyageai.com/v1/embeddings';
const RERANK_URL = 'https://api.voyageai.com/v1/rerank';
const DEFAULT_MODEL = 'voyage-code-3';
const DEFAULT_RERANK_MODEL = 'rerank-2.5-lite';
const DEFAULT_DIMENSIONS = 1024;
const DEFAULT_BATCH = 128;
const DEFAULT_MAX_RETRIES = 5;

export class VoyageCodeEmbeddingProvider implements ICodeEmbedding {
  readonly name = 'Voyage';
  readonly dimensions: number;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly rerankModel: string;
  private readonly batchSize: number;
  private readonly maxRetries: number;

  constructor(config: VoyageConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? DEFAULT_MODEL;
    this.rerankModel = config.rerankModel ?? DEFAULT_RERANK_MODEL;
    this.dimensions = config.dimensions ?? DEFAULT_DIMENSIONS;
    this.batchSize = config.batchSize ?? DEFAULT_BATCH;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
  }

  async embedCode(chunks: EmbedChunkInput[]): Promise<number[][]> {
    const texts = chunks.map((c) => c.content);
    return this.embedBatch(texts, 'document');
  }

  async embedQuery(query: string): Promise<number[]> {
    const vectors = await this.embedBatch([query], 'query');
    return vectors[0] ?? [];
  }

  async rerank(query: string, docs: RerankDoc[], topK: number): Promise<RerankResult[]> {
    if (docs.length === 0) {return [];}
    const body: VoyageRerankRequest = {
      query,
      documents: docs.map((d) => d.content),
      model: this.rerankModel,
      top_k: topK,
    };
    const json = await this.postWithRetry<VoyageRerankResponse>(RERANK_URL, body);
    return json.data
      .map((entry) => {
        const doc = docs[entry.index];
        if (!doc) {return null;}
        return { id: doc.id, score: entry.relevance_score };
      })
      .filter((r): r is RerankResult => r !== null);
  }

  private async embedBatch(
    texts: string[],
    inputType: 'document' | 'query',
  ): Promise<number[][]> {
    if (texts.length === 0) {return [];}
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);
      const body: VoyageEmbedRequest = {
        input: batch,
        model: this.model,
        input_type: inputType,
        output_dimension: this.dimensions,
      };
      const json = await this.postWithRetry<VoyageEmbedResponse>(EMBED_URL, body);
      const sorted = [...json.data].sort((a, b) => a.index - b.index);
      for (const item of sorted) {
        out.push(item.embedding);
      }
    }
    return out;
  }

  private async postWithRetry<T>(url: string, body: unknown): Promise<T> {
    let attempt = 0;
    let lastError: unknown = null;
    while (attempt <= this.maxRetries) {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });
      if (response.ok) {
        return (await response.json()) as T;
      }
      if (response.status === 429 || response.status >= 500) {
        const backoffMs = Math.min(1000 * 2 ** attempt, 30_000);
        await sleep(backoffMs);
        attempt += 1;
        lastError = new Error(`Voyage HTTP ${String(response.status)}`);
        continue;
      }
      const text = await response.text();
      throw new Error(`Voyage API error ${String(response.status)}: ${text}`);
    }
    throw new Error(
      `Voyage API exhausted retries (${String(this.maxRetries)}): ${String(lastError)}`,
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
