import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import { LmStudioCodeEmbeddingProvider } from '../../../../src/adapters/lmstudio/index.js';

type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const originalFetch = globalThis.fetch;

let fetchMock: Mock<FetchFn>;

beforeEach(() => {
  fetchMock = vi.fn<FetchFn>();
  globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function getCallArgs(index: number): [string | URL | Request, RequestInit | undefined] {
  const call = fetchMock.mock.calls[index];
  if (!call) {
    throw new Error(`fetchMock has no call at index ${String(index)}`);
  }
  return call;
}

function getCallBody(index: number): Record<string, unknown> {
  const [, init] = getCallArgs(index);
  const raw = init?.body;
  if (typeof raw !== 'string') {
    throw new Error(`fetchMock call ${String(index)} has no string body`);
  }
  return JSON.parse(raw) as Record<string, unknown>;
}

describe('LmStudioCodeEmbeddingProvider', () => {
  it('defaults to localhost:1234, qwen3 model, dim 1024', () => {
    const provider = new LmStudioCodeEmbeddingProvider();
    expect(provider.dimensions).toBe(1024);
    expect(provider.name).toBe('LmStudio');
  });

  it('embedCode POSTs to /v1/embeddings per chunk (batch=1 default)', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        jsonResponse({ data: [{ embedding: new Array(2560).fill(0.1) as number[], index: 0 }] }),
      ),
    );

    const provider = new LmStudioCodeEmbeddingProvider();
    await provider.embedCode([
      { content: 'a', kind: 'function' },
      { content: 'b', kind: 'function' },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url] = getCallArgs(0);
    expect(url).toBe('http://localhost:1234/v1/embeddings');
    const body = getCallBody(0);
    expect(body['model']).toBe('text-embedding-qwen3-embedding-4b');
    expect(body['input']).toBe('a');
  });

  it('Matryoshka slices output to dimensions (default 1024 from 2560)', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: [{ embedding: new Array(2560).fill(0.5).map((_, i) => i), index: 0 }],
      }),
    );

    const provider = new LmStudioCodeEmbeddingProvider();
    const [vec] = await provider.embedCode([{ content: 'x', kind: 'function' }]);

    expect(vec).toHaveLength(1024);
    expect(vec?.[0]).toBe(0);
    expect(vec?.[1023]).toBe(1023);
  });

  it('respects custom dimensions config', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: [{ embedding: new Array(2560).fill(0).map((_, i) => i), index: 0 }],
      }),
    );

    const provider = new LmStudioCodeEmbeddingProvider({ dimensions: 512 });
    const [vec] = await provider.embedCode([{ content: 'x', kind: 'function' }]);

    expect(vec).toHaveLength(512);
  });

  it('embedQuery prepends QUERY_INSTRUCTION', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: [{ embedding: new Array(2560).fill(0) as number[], index: 0 }] }),
    );

    const provider = new LmStudioCodeEmbeddingProvider();
    await provider.embedQuery('tax');

    const body = getCallBody(0);
    expect(String(body['input'])).toMatch(/Instruct:/);
    expect(String(body['input'])).toContain('Query: tax');
  });

  it('rerank is a stub that returns docs in original order', async () => {
    const provider = new LmStudioCodeEmbeddingProvider();
    const docs = [
      { id: 'a', content: 'apple' },
      { id: 'b', content: 'banana' },
      { id: 'c', content: 'cherry' },
    ];
    const result = await provider.rerank('fruit', docs, 2);

    expect(result.map((r) => r.id)).toEqual(['a', 'b']);
    expect(result.every((r) => r.score >= 0 && r.score <= 1)).toBe(true);
  });

  it('rerank empty docs returns empty array', async () => {
    const provider = new LmStudioCodeEmbeddingProvider();
    expect(await provider.rerank('q', [], 5)).toEqual([]);
  });

  it('retries on 5xx with exponential backoff', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('server error', { status: 503 }))
      .mockResolvedValueOnce(
        jsonResponse({ data: [{ embedding: new Array(2560).fill(0.5) as number[], index: 0 }] }),
      );

    const provider = new LmStudioCodeEmbeddingProvider({ maxRetries: 3 });
    const result = await provider.embedQuery('x');
    expect(result).toHaveLength(1024);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 30_000);

  it('throws on 4xx (not 429)', async () => {
    fetchMock.mockResolvedValueOnce(new Response('bad', { status: 400 }));

    const provider = new LmStudioCodeEmbeddingProvider();
    await expect(provider.embedQuery('x')).rejects.toThrow(/LM Studio error 400/);
  });

  it('respects custom URL and model', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: [{ embedding: new Array(2560).fill(0) as number[], index: 0 }] }),
    );

    const provider = new LmStudioCodeEmbeddingProvider({
      url: 'http://my-llama:8080',
      model: 'custom-model',
    });
    await provider.embedQuery('x');

    const [url] = getCallArgs(0);
    expect(url).toBe('http://my-llama:8080/v1/embeddings');
    const body = getCallBody(0);
    expect(body['model']).toBe('custom-model');
  });
});
