import { describe, it, expect, beforeEach, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const getCollections = vi.fn().mockResolvedValue({ collections: [] });
  const createCollection = vi.fn().mockResolvedValue(undefined);
  const createPayloadIndex = vi.fn().mockResolvedValue(undefined);
  const upsert = vi.fn().mockResolvedValue(undefined);
  const search = vi.fn().mockResolvedValue([]);
  const recommend = vi.fn().mockResolvedValue([]);
  const del = vi.fn().mockResolvedValue(undefined);
  const getCollection = vi.fn().mockResolvedValue({
    points_count: 0,
    config: { params: { vectors: { size: 1024 } } },
  });
  const deleteCollection = vi.fn().mockResolvedValue(undefined);

  const client = {
    getCollections,
    createCollection,
    createPayloadIndex,
    upsert,
    search,
    recommend,
    delete: del,
    getCollection,
    deleteCollection,
  };
  return {
    client,
    getCollections,
    createCollection,
    createPayloadIndex,
    upsert,
    search,
    recommend,
    del,
    getCollection,
    deleteCollection,
  };
});
const mockGetCollections = hoisted.getCollections;
const mockCreateCollection = hoisted.createCollection;
const mockCreatePayloadIndex = hoisted.createPayloadIndex;
const mockUpsert = hoisted.upsert;
const mockSearch = hoisted.search;
const mockRecommend = hoisted.recommend;
const mockDelete = hoisted.del;
const mockGetCollection = hoisted.getCollection;
const mockDeleteCollection = hoisted.deleteCollection;

vi.mock('@qdrant/js-client-rest', () => {
  class FakeQdrantClient {
    constructor() {
      return hoisted.client as unknown as FakeQdrantClient;
    }
  }
  return { QdrantClient: FakeQdrantClient };
});

import { QdrantCodeVectorStore } from '../../../../src/adapters/qdrant/index.js';
import { createCodeChunk, CODE_TEST_IDS } from '../../../fixtures/shared/test-constants.js';

beforeEach(() => {
  mockGetCollections.mockReset();
  mockGetCollections.mockResolvedValue({ collections: [] });
  mockCreateCollection.mockReset();
  mockCreateCollection.mockResolvedValue(undefined);
  mockCreatePayloadIndex.mockReset();
  mockCreatePayloadIndex.mockResolvedValue(undefined);
  mockUpsert.mockReset();
  mockUpsert.mockResolvedValue(undefined);
  mockSearch.mockReset();
  mockSearch.mockResolvedValue([]);
  mockRecommend.mockReset();
  mockRecommend.mockResolvedValue([]);
  mockDelete.mockReset();
  mockDelete.mockResolvedValue(undefined);
});

describe('QdrantCodeVectorStore', () => {
  it('ensureCollection creates collection + 3 payload indexes', async () => {
    const store = new QdrantCodeVectorStore({ url: 'http://localhost:6333' });
    await store.ensureCollection(CODE_TEST_IDS.projectA, 1024);

    expect(mockCreateCollection).toHaveBeenCalledWith(`code_${CODE_TEST_IDS.projectA}`, {
      vectors: { size: 1024, distance: 'Cosine' },
    });
    expect(mockCreatePayloadIndex).toHaveBeenCalledTimes(3);
    const fields = mockCreatePayloadIndex.mock.calls.map((c) => (c[1] as { field_name: string }).field_name).sort();
    expect(fields).toEqual(['filePath', 'kind', 'layer']);
  });

  it('ensureCollection is no-op when collection already exists', async () => {
    mockGetCollections.mockResolvedValue({ collections: [{ name: `code_${CODE_TEST_IDS.projectA}` }] });

    const store = new QdrantCodeVectorStore({ url: 'http://localhost:6333' });
    await store.ensureCollection(CODE_TEST_IDS.projectA, 1024);

    expect(mockCreateCollection).not.toHaveBeenCalled();
    expect(mockCreatePayloadIndex).not.toHaveBeenCalled();
  });

  it('upsertChunks batches and uses wait=true', async () => {
    const chunks = Array.from({ length: 300 }, (_, i) => createCodeChunk({ symbolId: `s${String(i)}`, content: `x${String(i)}` }));
    const vectors = chunks.map(() => [0.1, 0.2, 0.3, 0.4]);

    const store = new QdrantCodeVectorStore({ url: 'http://localhost:6333' });
    await store.upsertChunks(CODE_TEST_IDS.projectA, chunks, vectors);

    // 300 / 256 batch = 2 batches
    expect(mockUpsert).toHaveBeenCalledTimes(2);
    const firstArg = mockUpsert.mock.calls[0]?.[1] as { wait: boolean };
    expect(firstArg.wait).toBe(true);
  });

  it('upsertChunks throws on mismatched lengths', async () => {
    const store = new QdrantCodeVectorStore({ url: 'http://localhost:6333' });
    await expect(
      store.upsertChunks(CODE_TEST_IDS.projectA, [createCodeChunk()], []),
    ).rejects.toThrow(/length mismatch/);
  });

  it('searchSemantic builds filter from opts', async () => {
    const store = new QdrantCodeVectorStore({ url: 'http://localhost:6333' });
    await store.searchSemantic(CODE_TEST_IDS.projectA, [0.1, 0.2], {
      topK: 5,
      layer: 'domain',
      kind: 'class',
    });

    const args = mockSearch.mock.calls[0]?.[1] as {
      limit: number;
      filter: { must: { key: string; match: { value: string } }[] };
    };
    expect(args.limit).toBe(5);
    expect(args.filter.must).toEqual(
      expect.arrayContaining([
        { key: 'layer', match: { value: 'domain' } },
        { key: 'kind', match: { value: 'class' } },
      ]),
    );
  });

  it('searchSemantic without filters omits filter field', async () => {
    const store = new QdrantCodeVectorStore({ url: 'http://localhost:6333' });
    await store.searchSemantic(CODE_TEST_IDS.projectA, [0.1], { topK: 10 });

    const args = mockSearch.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(args['filter']).toBeUndefined();
  });

  it('findSimilar uses recommend API with hashed point id', async () => {
    const store = new QdrantCodeVectorStore({ url: 'http://localhost:6333' });
    await store.findSimilar(CODE_TEST_IDS.projectA, CODE_TEST_IDS.symbolInvoiceClass, 5);

    expect(mockRecommend).toHaveBeenCalled();
    const args = mockRecommend.mock.calls[0]?.[1] as { positive: string[]; limit: number };
    expect(args.limit).toBe(5);
    expect(args.positive).toHaveLength(1);
    expect(args.positive[0]).toMatch(/^[a-f0-9]{32}$/);
  });

  it('deleteByFile sends filter delete', async () => {
    const store = new QdrantCodeVectorStore({ url: 'http://localhost:6333' });
    await store.deleteByFile(CODE_TEST_IDS.projectA, 'src/A.ts');

    const args = mockDelete.mock.calls[0]?.[1] as { filter: { must: { key: string }[] } };
    expect(args.filter.must[0]?.key).toBe('filePath');
  });

  it('getCollectionStats returns pointCount and vectorDim', async () => {
    mockGetCollection.mockResolvedValueOnce({
      points_count: 42,
      config: { params: { vectors: { size: 1024 } } },
    });

    const store = new QdrantCodeVectorStore({ url: 'http://localhost:6333' });
    const stats = await store.getCollectionStats(CODE_TEST_IDS.projectA);

    expect(stats).toEqual({ pointCount: 42, vectorDim: 1024 });
  });

  it('deleteCollection forwards to client', async () => {
    const store = new QdrantCodeVectorStore({ url: 'http://localhost:6333' });
    await store.deleteCollection(CODE_TEST_IDS.projectA);
    expect(mockDeleteCollection).toHaveBeenCalledWith(`code_${CODE_TEST_IDS.projectA}`);
  });
});
