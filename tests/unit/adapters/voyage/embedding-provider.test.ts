import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import { VoyageCodeEmbeddingProvider } from '../../../../src/adapters/voyage/index.js';

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
  if (call === undefined) {
    throw new Error(`fetchMock has no call at index ${String(index)}`);
  }
  const [input, init] = call;
  return [input, init];
}

function getCallBody(index: number): Record<string, unknown> {
  const [, init] = getCallArgs(index);
  const raw = init?.body;
  if (typeof raw !== 'string') {
    throw new Error(`fetchMock call ${String(index)} has no string body`);
  }
  return JSON.parse(raw) as Record<string, unknown>;
}

describe('VoyageCodeEmbeddingProvider', () => {
  it('embedCode sends model and input_type=document', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: [{ embedding: [0.1, 0.2], index: 0 }] }),
    );

    const provider = new VoyageCodeEmbeddingProvider({ apiKey: 'pa-test' });
    const result = await provider.embedCode([{ content: 'function f() {}', kind: 'function' }]);

    expect(result).toEqual([[0.1, 0.2]]);
    const [url, init] = getCallArgs(0);
    expect(url).toBe('https://api.voyageai.com/v1/embeddings');
    const body = getCallBody(0);
    expect(body['model']).toBe('voyage-code-3');
    expect(body['input_type']).toBe('document');
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer pa-test',
    });
  });

  it('embedQuery sends input_type=query', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: [{ embedding: [0.3], index: 0 }] }),
    );

    const provider = new VoyageCodeEmbeddingProvider({ apiKey: 'pa-test' });
    const vec = await provider.embedQuery('tax calculation');

    expect(vec).toEqual([0.3]);
    const body = getCallBody(0);
    expect(body['input_type']).toBe('query');
  });

  it('embedCode batches at 128', async () => {
    fetchMock.mockImplementation(async () =>
      Promise.resolve(
        jsonResponse({ data: Array.from({ length: 128 }, (_, i) => ({ embedding: [0], index: i })) }),
      ),
    );

    const provider = new VoyageCodeEmbeddingProvider({ apiKey: 'pa-test' });
    const chunks = Array.from({ length: 200 }, (_, i) => ({ content: `c${String(i)}`, kind: 'function' as const }));
    await provider.embedCode(chunks);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rerank POSTs to /rerank endpoint with rerank model', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: [{ index: 1, relevance_score: 0.9 }, { index: 0, relevance_score: 0.5 }] }),
    );

    const provider = new VoyageCodeEmbeddingProvider({ apiKey: 'pa-test' });
    const docs = [{ id: 'a', content: 'apple' }, { id: 'b', content: 'banana' }];
    const result = await provider.rerank('fruit', docs, 2);

    expect(result).toEqual([
      { id: 'b', score: 0.9 },
      { id: 'a', score: 0.5 },
    ]);
    const [url] = getCallArgs(0);
    expect(url).toBe('https://api.voyageai.com/v1/rerank');
    const body = getCallBody(0);
    expect(body['model']).toBe('rerank-2.5-lite');
  });

  it('retries on HTTP 429 with exponential backoff', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('rate limited', { status: 429 }))
      .mockResolvedValueOnce(new Response('rate limited', { status: 429 }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ embedding: [0.5], index: 0 }] }));

    const provider = new VoyageCodeEmbeddingProvider({
      apiKey: 'pa-test',
      maxRetries: 5,
    });
    const result = await provider.embedQuery('x');
    expect(result).toEqual([0.5]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  }, 30_000);

  it('throws immediately on 4xx that is not 429', async () => {
    fetchMock.mockResolvedValueOnce(new Response('bad request', { status: 400 }));

    const provider = new VoyageCodeEmbeddingProvider({ apiKey: 'pa-test' });
    await expect(provider.embedQuery('x')).rejects.toThrow(/Voyage API error 400/);
  });

  it('has dimensions=1024 by default', () => {
    const provider = new VoyageCodeEmbeddingProvider({ apiKey: 'pa-test' });
    expect(provider.dimensions).toBe(1024);
  });
});
