import type { QdrantClient } from '@qdrant/js-client-rest';
import type {
  ICodeVectorStore,
  SearchSemanticOptions,
  CollectionStats,
} from '../../core/ports/code-vector-store.js';
import type { CodeChunk, SemanticHit } from '../../core/types/code.js';
import {
  createQdrantClient,
  collectionName,
  type QdrantAdapterConfig,
} from './client.js';
import { chunkToPoint, hashId, pointToHit } from './mapper.js';

const UPSERT_BATCH = 256;

export class QdrantCodeVectorStore implements ICodeVectorStore {
  readonly name = 'QdrantCodeVectorStore';
  private readonly client: QdrantClient;

  constructor(config: QdrantAdapterConfig) {
    this.client = createQdrantClient(config);
  }

  async initialize(): Promise<void> {
    await this.client.getCollections();
  }

  async ensureCollection(projectId: string, dim: number): Promise<void> {
    const name = collectionName(projectId);
    const existing = await this.client.getCollections();
    const present = existing.collections.some((c) => c.name === name);
    if (!present) {
      await this.client.createCollection(name, {
        vectors: { size: dim, distance: 'Cosine' },
      });
      await this.client.createPayloadIndex(name, {
        field_name: 'layer',
        field_schema: 'keyword',
      });
      await this.client.createPayloadIndex(name, {
        field_name: 'kind',
        field_schema: 'keyword',
      });
      await this.client.createPayloadIndex(name, {
        field_name: 'filePath',
        field_schema: 'keyword',
      });
    }
  }

  async upsertChunks(
    projectId: string,
    chunks: CodeChunk[],
    vectors: number[][],
  ): Promise<void> {
    if (chunks.length === 0) {return;}
    if (chunks.length !== vectors.length) {
      throw new Error(
        `Chunk/vector length mismatch: ${String(chunks.length)} chunks vs ${String(vectors.length)} vectors`,
      );
    }
    const name = collectionName(projectId);
    const points = chunks.map((c, i) => chunkToPoint(c, vectors[i] ?? []));
    for (let i = 0; i < points.length; i += UPSERT_BATCH) {
      const slice = points.slice(i, i + UPSERT_BATCH);
      await this.client.upsert(name, { points: slice, wait: true });
    }
  }

  async deleteByFile(projectId: string, filePath: string): Promise<void> {
    const name = collectionName(projectId);
    await this.client.delete(name, {
      filter: { must: [{ key: 'filePath', match: { value: filePath } }] },
      wait: true,
    });
  }

  async deleteBySymbol(projectId: string, symbolId: string): Promise<void> {
    const name = collectionName(projectId);
    await this.client.delete(name, {
      filter: { must: [{ key: 'symbolId', match: { value: symbolId } }] },
      wait: true,
    });
  }

  async searchSemantic(
    projectId: string,
    vector: number[],
    opts: SearchSemanticOptions,
  ): Promise<SemanticHit[]> {
    const name = collectionName(projectId);
    const must: { key: string; match: { value: string } }[] = [];
    if (opts.layer) {must.push({ key: 'layer', match: { value: opts.layer } });}
    if (opts.kind) {must.push({ key: 'kind', match: { value: opts.kind } });}
    if (opts.filePath) {must.push({ key: 'filePath', match: { value: opts.filePath } });}

    const searchArgs: Parameters<QdrantClient['search']>[1] = {
      vector,
      limit: opts.topK,
      with_payload: true,
    };
    if (must.length > 0) {
      searchArgs.filter = { must };
    }
    const result = await this.client.search(name, searchArgs);
    return result.map(pointToHit);
  }

  async findSimilar(
    projectId: string,
    symbolId: string,
    topK: number,
  ): Promise<SemanticHit[]> {
    const name = collectionName(projectId);
    const pointId = hashId(`${projectId}:${symbolId}`);
    try {
      const result = await this.client.recommend(name, {
        positive: [pointId],
        limit: topK,
        with_payload: true,
      });
      return result.map(pointToHit);
    } catch (err) {
      if (isNotFoundError(err)) {
        return [];
      }
      throw err;
    }
  }

  async getCollectionStats(projectId: string): Promise<CollectionStats> {
    const name = collectionName(projectId);
    const info = await this.client.getCollection(name);
    const vectorsConfig = info.config.params.vectors;
    let vectorDim = 0;
    if (vectorsConfig && typeof vectorsConfig === 'object' && 'size' in vectorsConfig) {
      vectorDim = (vectorsConfig as { size: number }).size;
    }
    return {
      pointCount: info.points_count ?? 0,
      vectorDim,
    };
  }

  async collectionExists(projectId: string): Promise<boolean> {
    const name = collectionName(projectId);
    const existing = await this.client.getCollections();
    return existing.collections.some((c) => c.name === name);
  }

  async deleteCollection(projectId: string): Promise<void> {
    await this.client.deleteCollection(collectionName(projectId));
  }

  async close(): Promise<void> { /* QdrantClient has no explicit close */ }
}

/**
 * Qdrant returns 404 when `recommend` is called with a positive id that
 * does not exist in the collection. Treat this as "no seed → no neighbours"
 * rather than a transport-level failure so MCP tools can present an empty
 * result instead of leaking infrastructure details to the LLM.
 */
function isNotFoundError(err: unknown): boolean {
  if (err === null || typeof err !== 'object') {
    return false;
  }
  const status = (err as { status?: unknown }).status;
  if (typeof status === 'number' && status === 404) {
    return true;
  }
  const message = (err as { message?: unknown }).message;
  return typeof message === 'string' && /not\s*found/i.test(message);
}
