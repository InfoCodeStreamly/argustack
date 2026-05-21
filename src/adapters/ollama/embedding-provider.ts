import type {
  ICodeEmbedding,
  EmbedChunkInput,
  RerankDoc,
  RerankResult,
} from '../../core/ports/code-embedding.js';

const DEFAULT_URL = 'http://localhost:11434';
const DEFAULT_MODEL = 'nomic-embed-text';
const DEFAULT_DIMENSIONS = 768;
const DEFAULT_MAX_RETRIES = 3;
/** Conservative budget for nomic-embed-text (2048 context tokens, ~3 chars/token). */
const MAX_CHARS_PER_INPUT = 5500;
/** When Ollama replies with "input length exceeds context", shrink and retry. */
const SHRINK_FACTOR = 0.6;
const MIN_CHARS_PER_INPUT = 256;

export interface OllamaCodeEmbeddingConfig {
  readonly url?: string;
  readonly model?: string;
  readonly dimensions?: number;
  readonly maxRetries?: number;
}

interface OllamaEmbeddingResponse {
  embedding?: number[];
  error?: string;
}

/**
 * Ollama embedding adapter — talks to native `POST /api/embeddings`.
 *
 * The rerank() implementation is a stub (returns documents in their
 * original order with linearly decaying scores). Ollama exposes only
 * embeddings out of the box; chat-based reranking would require a
 * separate model and is intentionally not implemented here.
 */
export class OllamaCodeEmbeddingProvider implements ICodeEmbedding {
  readonly name = 'Ollama';
  readonly dimensions: number;
  private readonly url: string;
  private readonly model: string;
  private readonly maxRetries: number;

  constructor(config: OllamaCodeEmbeddingConfig = {}) {
    this.url = (config.url ?? DEFAULT_URL).replace(/\/$/, '');
    this.model = config.model ?? DEFAULT_MODEL;
    this.dimensions = config.dimensions ?? DEFAULT_DIMENSIONS;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
  }

  async embedCode(chunks: EmbedChunkInput[]): Promise<number[][]> {
    if (chunks.length === 0) { return []; }
    const texts = chunks.map((c) => truncate(c.content));
    return this.embedSequential(texts);
  }

  async embedQuery(query: string): Promise<number[]> {
    const vectors = await this.embedSequential([truncate(query)]);
    return vectors[0] ?? [];
  }

  rerank(_query: string, docs: RerankDoc[], topK: number): Promise<RerankResult[]> {
    if (docs.length === 0) {
      return Promise.resolve([]);
    }
    const limit = Math.min(topK, docs.length);
    const results: RerankResult[] = [];
    for (let i = 0; i < limit; i++) {
      const doc = docs[i];
      if (!doc) { continue; }
      results.push({ id: doc.id, score: 1 - i / Math.max(1, docs.length) });
    }
    return Promise.resolve(results);
  }

  private async embedSequential(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i++) {
      const raw = texts[i] ?? '';
      const vec = await this.embedOne(raw);
      out.push(this.sliceMatryoshka(vec));
      if (i % 25 === 0) {
        process.stderr.write(`[ollama-embed] ${String(i + 1)}/${String(texts.length)}\n`);
      }
    }
    return out;
  }

  private sliceMatryoshka(vec: number[]): number[] {
    if (vec.length <= this.dimensions) { return vec; }
    return vec.slice(0, this.dimensions);
  }

  private async embedOne(input: string): Promise<number[]> {
    let payload = input;
    let attempt = 0;
    let lastError: unknown = null;
    while (attempt <= this.maxRetries) {
      try {
        const response = await fetch(`${this.url}/api/embeddings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: this.model, prompt: payload }),
        });
        if (response.ok) {
          const data = await response.json() as OllamaEmbeddingResponse;
          if (Array.isArray(data.embedding)) {
            return data.embedding;
          }
          throw new Error(`Ollama: malformed response (no embedding) — ${data.error ?? ''}`);
        }
        if (response.status >= 500) {
          attempt += 1;
          const body = await response.text().catch(() => '');
          lastError = new Error(`Ollama HTTP ${String(response.status)}: ${body.slice(0, 200)}`);
          if (body.includes('context length') && payload.length > MIN_CHARS_PER_INPUT) {
            payload = payload.slice(0, Math.max(MIN_CHARS_PER_INPUT, Math.floor(payload.length * SHRINK_FACTOR)));
            continue;
          }
          await sleep(500 * 2 ** attempt);
          continue;
        }
        const text = await response.text();
        throw new Error(`Ollama HTTP ${String(response.status)}: ${text}`);
      } catch (err) {
        if (attempt >= this.maxRetries) {
          throw err instanceof Error ? err : new Error(String(err));
        }
        lastError = err;
        attempt += 1;
        await sleep(500 * 2 ** attempt);
      }
    }
    throw new Error(`Ollama exhausted retries (${String(this.maxRetries)}): ${String(lastError)}`);
  }
}

function truncate(text: string): string {
  return text.length > MAX_CHARS_PER_INPUT ? text.slice(0, MAX_CHARS_PER_INPUT) : text;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
