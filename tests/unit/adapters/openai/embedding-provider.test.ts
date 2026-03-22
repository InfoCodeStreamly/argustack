import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAIEmbeddingProvider } from '../../../../src/adapters/openai/embedding-provider.js';

describe('OpenAIEmbeddingProvider', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('sets default model and dimensions', () => {
    const provider = new OpenAIEmbeddingProvider({ apiKey: 'test-key' });
    expect(provider.name).toBe('OpenAI');
    expect(provider.dimensions).toBe(1536);
  });

  it('allows custom model and dimensions', () => {
    const provider = new OpenAIEmbeddingProvider({
      apiKey: 'test-key',
      model: 'text-embedding-3-large',
      dimensions: 3072,
    });
    expect(provider.dimensions).toBe(3072);
  });

  it('calls OpenAI API with correct payload', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        data: [
          { embedding: [0.1, 0.2], index: 0 },
          { embedding: [0.3, 0.4], index: 1 },
        ],
      }),
    });
    globalThis.fetch = mockFetch;

    const provider = new OpenAIEmbeddingProvider({ apiKey: 'sk-test' });
    await provider.embed(['hello', 'world']);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/embeddings');
    expect(options.method).toBe('POST');

    const headers = options.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer sk-test');

    const body = JSON.parse(options.body as string) as { model: string; input: string[]; dimensions: number };
    expect(body.model).toBe('text-embedding-3-small');
    expect(body.input).toEqual(['hello', 'world']);
    expect(body.dimensions).toBe(1536);
  });

  it('returns vectors in input order', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        data: [
          { embedding: [0.3, 0.4], index: 1 },
          { embedding: [0.1, 0.2], index: 0 },
        ],
      }),
    });

    const provider = new OpenAIEmbeddingProvider({ apiKey: 'sk-test' });
    const result = await provider.embed(['first', 'second']);

    expect(result).toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
  });

  it('throws on API error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('Unauthorized'),
    });

    const provider = new OpenAIEmbeddingProvider({ apiKey: 'bad-key' });
    await expect(provider.embed(['test'])).rejects.toThrow('OpenAI API error 401: Unauthorized');
  });
});
