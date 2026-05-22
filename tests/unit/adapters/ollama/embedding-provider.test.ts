import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import { OllamaCodeEmbeddingProvider } from '../../../../src/adapters/ollama/index.js';

type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const originalFetch = globalThis.fetch;
const originalStderrWrite = process.stderr.write.bind(process.stderr);

let fetchMock: Mock<FetchFn>;

beforeEach(() => {
  fetchMock = vi.fn<FetchFn>();
  globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  process.stderr.write = ((): boolean => true) as typeof process.stderr.write;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.stderr.write = originalStderrWrite;
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

describe('OllamaCodeEmbeddingProvider', () => {
  it('defaults to localhost:11434, nomic-embed-text, dim 768', () => {
    const provider = new OllamaCodeEmbeddingProvider();
    expect(provider.dimensions).toBe(768);
    expect(provider.name).toBe('Ollama');
  });

  it('trims trailing slash from base URL', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ embedding: new Array(768).fill(0.1) as number[] }),
    );
    const provider = new OllamaCodeEmbeddingProvider({ url: 'http://host:11434/' });
    await provider.embedQuery('q');
    const [url] = getCallArgs(0);
    expect(url).toBe('http://host:11434/api/embeddings');
  });

  it('embedCode returns empty array for empty input', async () => {
    const provider = new OllamaCodeEmbeddingProvider();
    expect(await provider.embedCode([])).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('embedCode POSTs to /api/embeddings per chunk', async () => {
    fetchMock.mockImplementation(async () =>
      Promise.resolve(jsonResponse({ embedding: new Array(768).fill(0.1) as number[] })),
    );

    const provider = new OllamaCodeEmbeddingProvider();
    const vectors = await provider.embedCode([
      { content: 'a', kind: 'function' },
      { content: 'b', kind: 'function' },
    ]);

    expect(vectors).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url] = getCallArgs(0);
    expect(url).toBe('http://localhost:11434/api/embeddings');
    const body = getCallBody(0);
    expect(body['model']).toBe('nomic-embed-text');
    expect(body['prompt']).toBe('a');
  });

  it('embedQuery returns first vector and uses default model', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ embedding: [0.5, 0.6, 0.7] }),
    );

    const provider = new OllamaCodeEmbeddingProvider();
    const vec = await provider.embedQuery('tax calculation');
    expect(vec).toEqual([0.5, 0.6, 0.7]);

    const body = getCallBody(0);
    expect(body['prompt']).toBe('tax calculation');
  });

  it('Matryoshka slices long vectors to configured dimensions', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        embedding: new Array(1024).fill(0).map((_, i) => i),
      }),
    );

    const provider = new OllamaCodeEmbeddingProvider({ dimensions: 256 });
    const [vec] = await provider.embedCode([{ content: 'x', kind: 'function' }]);
    expect(vec).toHaveLength(256);
    expect(vec?.[0]).toBe(0);
    expect(vec?.[255]).toBe(255);
  });

  it('returns short vectors unchanged when length <= dimensions', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ embedding: [0.1, 0.2] }),
    );
    const provider = new OllamaCodeEmbeddingProvider({ dimensions: 768 });
    const vec = await provider.embedQuery('x');
    expect(vec).toEqual([0.1, 0.2]);
  });

  it('truncates input longer than 5500 chars', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ embedding: [0.1] }),
    );
    const provider = new OllamaCodeEmbeddingProvider();
    const longText = 'a'.repeat(7000);
    await provider.embedQuery(longText);

    const body = getCallBody(0);
    expect(String(body['prompt'])).toHaveLength(5500);
  });

  it('respects custom URL and model', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ embedding: [0.1] }),
    );
    const provider = new OllamaCodeEmbeddingProvider({
      url: 'http://my-ollama:9999',
      model: 'custom-emb',
    });
    await provider.embedQuery('x');

    const [url] = getCallArgs(0);
    expect(url).toBe('http://my-ollama:9999/api/embeddings');
    const body = getCallBody(0);
    expect(body['model']).toBe('custom-emb');
  });

  it('rerank returns docs in original order with decaying scores', async () => {
    const provider = new OllamaCodeEmbeddingProvider();
    const docs = [
      { id: 'a', content: 'apple' },
      { id: 'b', content: 'banana' },
      { id: 'c', content: 'cherry' },
    ];
    const result = await provider.rerank('fruit', docs, 2);
    expect(result.map((r) => r.id)).toEqual(['a', 'b']);
    expect(result[0]?.score).toBeGreaterThan(result[1]?.score ?? 0);
    expect(result.every((r) => r.score >= 0 && r.score <= 1)).toBe(true);
  });

  it('rerank empty docs returns empty array', async () => {
    const provider = new OllamaCodeEmbeddingProvider();
    expect(await provider.rerank('q', [], 5)).toEqual([]);
  });

  it('rerank clamps topK to docs length', async () => {
    const provider = new OllamaCodeEmbeddingProvider();
    const docs = [{ id: 'a', content: 'a' }];
    const result = await provider.rerank('q', docs, 99);
    expect(result).toHaveLength(1);
  });

  it('throws when response embedding is missing', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'no model' }));
    const provider = new OllamaCodeEmbeddingProvider({ maxRetries: 0 });
    await expect(provider.embedQuery('x')).rejects.toThrow(/malformed response/);
  });

  it('throws on 4xx (non-retryable)', async () => {
    fetchMock.mockResolvedValueOnce(new Response('bad request', { status: 400 }));
    const provider = new OllamaCodeEmbeddingProvider({ maxRetries: 0 });
    await expect(provider.embedQuery('x')).rejects.toThrow(/Ollama HTTP 400/);
  });

  it('retries on 5xx and succeeds on subsequent attempt', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('server error', { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ embedding: [0.9] }));

    const provider = new OllamaCodeEmbeddingProvider({ maxRetries: 3 });
    const result = await provider.embedQuery('x');
    expect(result).toEqual([0.9]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 30_000);

  it('shrinks payload when 5xx mentions context length', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('input length exceeds context length', { status: 500 }))
      .mockResolvedValueOnce(jsonResponse({ embedding: [0.1] }));

    const provider = new OllamaCodeEmbeddingProvider({ maxRetries: 3 });
    const initial = 'x'.repeat(2000);
    await provider.embedQuery(initial);

    const firstBody = getCallBody(0);
    const secondBody = getCallBody(1);
    expect(String(firstBody['prompt']).length).toBeGreaterThan(String(secondBody['prompt']).length);
  }, 30_000);
});
