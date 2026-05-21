import { createHash } from 'node:crypto';
import type {
  ICodeEmbedding,
  EmbedChunkInput,
  RerankDoc,
  RerankResult,
} from '../../../src/core/ports/code-embedding.js';

export class FakeCodeEmbedding implements ICodeEmbedding {
  readonly name = 'FakeCodeEmbedding';
  readonly dimensions: number;

  readonly embedCalls: { kind: 'code' | 'query'; count: number }[] = [];
  readonly rerankCalls: { query: string; docCount: number; topK: number }[] = [];

  constructor(dimensions = 16) {
    this.dimensions = dimensions;
  }

  embedCode(chunks: EmbedChunkInput[]): Promise<number[][]> {
    this.embedCalls.push({ kind: 'code', count: chunks.length });
    return Promise.resolve(chunks.map((c) => this.deterministicVector(c.content)));
  }

  embedQuery(query: string): Promise<number[]> {
    this.embedCalls.push({ kind: 'query', count: 1 });
    return Promise.resolve(this.deterministicVector(query));
  }

  rerank(
    query: string,
    docs: RerankDoc[],
    topK: number,
  ): Promise<RerankResult[]> {
    this.rerankCalls.push({ query, docCount: docs.length, topK });
    const qTokens = tokenize(query);
    const scored = docs.map((d) => ({
      id: d.id,
      score: overlap(qTokens, tokenize(d.content)),
    }));
    scored.sort((a, b) => b.score - a.score);
    return Promise.resolve(scored.slice(0, topK));
  }

  clear(): void {
    this.embedCalls.length = 0;
    this.rerankCalls.length = 0;
  }

  private deterministicVector(text: string): number[] {
    const hash = createHash('sha256').update(text, 'utf8').digest();
    const vec: number[] = new Array<number>(this.dimensions).fill(0);
    for (let i = 0; i < this.dimensions; i++) {
      const byte = hash[i % hash.length] ?? 0;
      vec[i] = (byte / 255) * 2 - 1;
    }
    return vec;
  }
}

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 0),
  );
}

function overlap(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const t of a) {
    if (b.has(t)) {count += 1;}
  }
  return count;
}
