import type {
  ICodeVectorStore,
  SearchSemanticOptions,
  CollectionStats,
} from '../../../src/core/ports/code-vector-store.js';
import type {
  CodeChunk,
  SemanticHit,
  CodeLayer,
  CodeSymbolKind,
} from '../../../src/core/types/code.js';

interface VectorEntry {
  symbolId: string;
  vector: number[];
  payload: {
    filePath: string;
    layer: CodeLayer | null;
    kind: CodeSymbolKind;
    name: string;
    startLine: number;
    endLine: number;
    content?: string;
  };
}

export class FakeCodeVectorStore implements ICodeVectorStore {
  readonly name = 'FakeCodeVectorStore';

  readonly collections = new Map<string, { dim: number; entries: Map<string, VectorEntry> }>();

  readonly initializeCalls: number[] = [];
  readonly ensureCollectionCalls: { projectId: string; dim: number }[] = [];
  readonly upsertCalls: { projectId: string; count: number }[] = [];
  readonly searchCalls: { projectId: string; opts: SearchSemanticOptions }[] = [];
  readonly deleteFileCalls: { projectId: string; filePath: string }[] = [];

  async initialize(): Promise<void> {
    this.initializeCalls.push(Date.now());
    return Promise.resolve();
  }

  async ensureCollection(projectId: string, dim: number): Promise<void> {
    this.ensureCollectionCalls.push({ projectId, dim });
    if (!this.collections.has(projectId)) {
      this.collections.set(projectId, { dim, entries: new Map() });
    }
    return Promise.resolve();
  }

  async upsertChunks(
    projectId: string,
    chunks: CodeChunk[],
    vectors: number[][],
  ): Promise<void> {
    this.upsertCalls.push({ projectId, count: chunks.length });
    const col = this.getOrCreate(projectId, vectors[0]?.length ?? 1024);
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const vec = vectors[i];
      if (chunk === undefined || vec === undefined) {continue;}
      const entry: VectorEntry = {
        symbolId: chunk.symbolId,
        vector: vec,
        payload: {
          filePath: chunk.filePath,
          layer: chunk.layer,
          kind: chunk.kind,
          name: chunk.name,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          content: chunk.content,
        },
      };
      col.entries.set(chunk.symbolId, entry);
    }
    return Promise.resolve();
  }

  async deleteByFile(projectId: string, filePath: string): Promise<void> {
    this.deleteFileCalls.push({ projectId, filePath });
    const col = this.collections.get(projectId);
    if (col === undefined) {return Promise.resolve();}
    for (const [id, entry] of col.entries) {
      if (entry.payload.filePath === filePath) {
        col.entries.delete(id);
      }
    }
    return Promise.resolve();
  }

  async deleteBySymbol(projectId: string, symbolId: string): Promise<void> {
    this.collections.get(projectId)?.entries.delete(symbolId);
    return Promise.resolve();
  }

  async searchSemantic(
    projectId: string,
    vector: number[],
    opts: SearchSemanticOptions,
  ): Promise<SemanticHit[]> {
    this.searchCalls.push({ projectId, opts });
    const col = this.collections.get(projectId);
    if (col === undefined) {return Promise.resolve([]);}
    const ranked: { entry: VectorEntry; score: number }[] = [];
    for (const entry of col.entries.values()) {
      if (opts.layer !== undefined && entry.payload.layer !== opts.layer) {continue;}
      if (opts.kind !== undefined && entry.payload.kind !== opts.kind) {continue;}
      if (opts.filePath !== undefined && opts.filePath !== '' && entry.payload.filePath !== opts.filePath) {continue;}
      ranked.push({ entry, score: cosineSimilarity(vector, entry.vector) });
    }
    ranked.sort((a, b) => b.score - a.score);
    return Promise.resolve(
      ranked.slice(0, opts.topK).map((r) => ({
        symbolId: r.entry.symbolId,
        score: r.score,
        payload: {
          projectId,
          filePath: r.entry.payload.filePath,
          layer: r.entry.payload.layer,
          kind: r.entry.payload.kind,
          name: r.entry.payload.name,
          startLine: r.entry.payload.startLine,
          endLine: r.entry.payload.endLine,
          ...(r.entry.payload.content !== undefined
            ? { content: r.entry.payload.content }
            : {}),
        },
      })),
    );
  }

  async findSimilar(
    projectId: string,
    symbolId: string,
    topK: number,
  ): Promise<SemanticHit[]> {
    const col = this.collections.get(projectId);
    if (col === undefined) {return Promise.resolve([]);}
    const seed = col.entries.get(symbolId);
    if (seed === undefined) {return Promise.resolve([]);}
    const ranked: { entry: VectorEntry; score: number }[] = [];
    for (const entry of col.entries.values()) {
      if (entry.symbolId === symbolId) {continue;}
      ranked.push({ entry, score: cosineSimilarity(seed.vector, entry.vector) });
    }
    ranked.sort((a, b) => b.score - a.score);
    return Promise.resolve(
      ranked.slice(0, topK).map((r) => ({
        symbolId: r.entry.symbolId,
        score: r.score,
        payload: {
          projectId,
          filePath: r.entry.payload.filePath,
          layer: r.entry.payload.layer,
          kind: r.entry.payload.kind,
          name: r.entry.payload.name,
          startLine: r.entry.payload.startLine,
          endLine: r.entry.payload.endLine,
        },
      })),
    );
  }

  async getCollectionStats(projectId: string): Promise<CollectionStats> {
    const col = this.collections.get(projectId);
    return Promise.resolve({
      pointCount: col?.entries.size ?? 0,
      vectorDim: col?.dim ?? 0,
    });
  }

  async collectionExists(projectId: string): Promise<boolean> {
    return Promise.resolve(this.collections.has(projectId));
  }

  async deleteCollection(projectId: string): Promise<void> {
    this.collections.delete(projectId);
    return Promise.resolve();
  }

  async close(): Promise<void> {
    return Promise.resolve();
  }

  clear(): void {
    this.collections.clear();
    this.initializeCalls.length = 0;
    this.ensureCollectionCalls.length = 0;
    this.upsertCalls.length = 0;
    this.searchCalls.length = 0;
    this.deleteFileCalls.length = 0;
  }

  private getOrCreate(projectId: string, dim: number): { dim: number; entries: Map<string, VectorEntry> } {
    let col = this.collections.get(projectId);
    if (col === undefined) {
      col = { dim, entries: new Map() };
      this.collections.set(projectId, col);
    }
    return col;
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) {return 0;}
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
