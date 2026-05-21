import { describe, it, expect, vi } from 'vitest';

vi.mock('@qdrant/js-client-rest', () => {
  class FakeQdrantClient {
    constructor(public readonly opts: { url: string; apiKey?: string }) {}
  }
  return { QdrantClient: FakeQdrantClient };
});

describe('qdrant/client', () => {
  it('createQdrantClient applies url + optional apiKey', async () => {
    const { createQdrantClient } = await import('../../../../src/adapters/qdrant/client.js');
    const c1 = createQdrantClient({ url: 'http://x' }) as unknown as { opts: { url: string; apiKey?: string } };
    expect(c1.opts.url).toBe('http://x');
    expect(c1.opts.apiKey).toBeUndefined();
    const c2 = createQdrantClient({ url: 'http://x', apiKey: 'k' }) as unknown as { opts: { url: string; apiKey?: string } };
    expect(c2.opts.apiKey).toBe('k');
  });

  it('collectionName sanitizes projectId', async () => {
    const { collectionName } = await import('../../../../src/adapters/qdrant/client.js');
    expect(collectionName('arg.proj!1')).toBe('code_arg_proj_1');
    expect(collectionName('simple')).toBe('code_simple');
  });
});
