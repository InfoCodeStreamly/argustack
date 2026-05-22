import type {
  ICodeEmbedding,
  EmbedChunkInput,
  RerankDoc,
  RerankResult,
} from '../../core/ports/code-embedding.js';

export interface LmStudioConfig {
  url?: string;
  model?: string;
  dimensions?: number;
  batchSize?: number;
  maxRetries?: number;
  /** When set, rerank() calls /v1/chat/completions with this model (e.g. Qwen3-Reranker). Omit for stub. */
  rerankModel?: string;
}

interface OpenAIEmbeddingResponse {
  object: string;
  data: { object: string; embedding: number[]; index: number }[];
  model: string;
  usage?: { prompt_tokens?: number; total_tokens?: number };
}

interface ChatCompletionResponse {
  choices: { message: { content: string } }[];
}

const RERANK_SYSTEM_PROMPT =
  'You are a relevance judge. Given a search query and a code document, output ONLY a single number between 0 and 1 indicating how relevant the document is to the query. 1.0 = highly relevant, 0.0 = irrelevant. No other text.';

const DEFAULT_URL = 'http://localhost:1234';
const DEFAULT_MODEL = 'text-embedding-qwen3-embedding-4b';
const DEFAULT_DIMENSIONS = 1024;
const DEFAULT_BATCH = 1;
const DEFAULT_MAX_RETRIES = 3;
const MAX_CHARS_PER_INPUT = 6000;

const QUERY_INSTRUCTION =
  'Instruct: Given a code search query, retrieve relevant code snippets\nQuery: ';

/**
 * LM Studio adapter — runs Qwen3-Embedding-4B (or any embedding GGUF) locally.
 *
 * Exposes the OpenAI-compatible `/v1/embeddings` endpoint on `http://localhost:1234`.
 * Native Qwen3 output is 2560-d; we Matryoshka-slice client-side to `dimensions`
 * (default 1024) so the Qdrant schema matches the original voyage-code-3 plan.
 *
 * The reranker stub returns documents in their original order — Qwen3-Reranker
 * is a separate model and is deferred to v0.2.
 */
export class LmStudioCodeEmbeddingProvider implements ICodeEmbedding {
  readonly name = 'LmStudio';
  readonly dimensions: number;
  private readonly url: string;
  private readonly model: string;
  private readonly maxRetries: number;
  private readonly rerankModel: string | null;

  constructor(config: LmStudioConfig = {}) {
    this.url = (config.url ?? DEFAULT_URL).replace(/\/$/, '');
    this.model = config.model ?? DEFAULT_MODEL;
    this.dimensions = config.dimensions ?? DEFAULT_DIMENSIONS;
    void config.batchSize;
    void DEFAULT_BATCH;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.rerankModel = config.rerankModel ?? null;
  }

  async embedCode(chunks: EmbedChunkInput[]): Promise<number[][]> {
    if (chunks.length === 0) {return [];}
    const texts = chunks.map((c) => c.content);
    return this.embedBatched(texts);
  }

  async embedQuery(query: string): Promise<number[]> {
    const vectors = await this.embedBatched([QUERY_INSTRUCTION + query]);
    return vectors[0] ?? [];
  }

  async rerank(query: string, docs: RerankDoc[], topK: number): Promise<RerankResult[]> {
    if (docs.length === 0) {
      return [];
    }
    if (this.rerankModel === null || this.rerankModel === '') {
      const limit = Math.min(topK, docs.length);
      const results: RerankResult[] = [];
      for (let i = 0; i < limit; i++) {
        const doc = docs[i];
        if (doc === undefined) {continue;}
        results.push({ id: doc.id, score: 1 - i / Math.max(1, docs.length) });
      }
      return results;
    }

    const scored: RerankResult[] = [];
    for (const doc of docs) {
      try {
        const score = await this.scoreRelevance(query, doc.content);
        scored.push({ id: doc.id, score });
      } catch {
        scored.push({ id: doc.id, score: 0 });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  private async scoreRelevance(query: string, document: string): Promise<number> {
    const truncated = document.length > MAX_CHARS_PER_INPUT
      ? document.slice(0, MAX_CHARS_PER_INPUT)
      : document;
    const body = {
      model: this.rerankModel,
      messages: [
        { role: 'system', content: RERANK_SYSTEM_PROMPT },
        { role: 'user', content: `Query: ${query}\n\nDocument:\n${truncated}\n\nRelevance score (0.0 to 1.0):` },
      ],
      temperature: 0,
      max_tokens: 8,
    };
    const response = await fetch(`${this.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new LmStudioClientError(`LM Studio rerank error ${String(response.status)}`);
    }
    const json = (await response.json()) as ChatCompletionResponse;
    const text = json.choices[0]?.message.content ?? '';
    const match = /([0-9]*\.?[0-9]+)/.exec(text);
    if (match === null) {
      return 0;
    }
    const parsed = Number(match[1]);
    if (Number.isNaN(parsed)) {
      return 0;
    }
    return Math.max(0, Math.min(1, parsed));
  }

  private async embedBatched(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i++) {
      const raw = texts[i] ?? '';
      const truncated = raw.length > MAX_CHARS_PER_INPUT ? raw.slice(0, MAX_CHARS_PER_INPUT) : raw;
      const json = await this.postWithRetry(truncated);
      const vec = json.data[0]?.embedding ?? [];
      out.push(this.sliceMatryoshka(vec));
      if (i % 25 === 0) {
        process.stderr.write(`[embed] ${String(i + 1)}/${String(texts.length)}\n`);
      }
    }
    return out;
  }

  private sliceMatryoshka(vec: number[]): number[] {
    if (vec.length <= this.dimensions) {return vec;}
    return vec.slice(0, this.dimensions);
  }

  private async postWithRetry(input: string): Promise<OpenAIEmbeddingResponse> {
    let attempt = 0;
    let lastError: unknown = null;
    while (attempt <= this.maxRetries) {
      try {
        const response = await fetch(`${this.url}/v1/embeddings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: this.model, input }),
        });
        if (response.ok) {
          return (await response.json()) as OpenAIEmbeddingResponse;
        }
        if (response.status >= 500) {
          attempt += 1;
          lastError = new Error(`LM Studio HTTP ${String(response.status)}`);
          await sleep(500 * 2 ** attempt);
          continue;
        }
        const text = await response.text();
        throw new LmStudioClientError(`LM Studio error ${String(response.status)}: ${text}`);
      } catch (error) {
        if (error instanceof LmStudioClientError) {
          throw error;
        }
        if (attempt >= this.maxRetries) {
          throw error instanceof Error ? error : new Error(String(error));
        }
        lastError = error;
        attempt += 1;
        await sleep(500 * 2 ** attempt);
      }
    }
    throw new Error(
      `LM Studio exhausted retries (${String(this.maxRetries)}): ${String(lastError)}`,
    );
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class LmStudioClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LmStudioClientError';
  }
}
