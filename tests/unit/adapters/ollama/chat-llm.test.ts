/**
 * Unit tests for {@link OllamaChatLlm}. Mocks `globalThis.fetch` so no
 * real Ollama daemon is touched.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OllamaChatLlm } from '../../../../src/adapters/ollama/chat-llm.js';

interface FetchMock {
  mock: ReturnType<typeof vi.fn>;
  restore: () => void;
}

function mockFetch(reply: { ok: boolean; body?: unknown; throws?: Error }): FetchMock {
  const original = globalThis.fetch;
  const fn = vi.fn(async (): Promise<Response> => {
    await Promise.resolve();
    if (reply.throws !== undefined) {
      throw reply.throws;
    }
    return {
      ok: reply.ok,
      json: async () => {
        await Promise.resolve();
        return reply.body ?? {};
      },
    } as unknown as Response;
  });
  globalThis.fetch = fn as unknown as typeof fetch;
  return { mock: fn, restore: () => { globalThis.fetch = original; } };
}

let f: FetchMock;

afterEach(() => {
  f.restore();
});

describe('OllamaChatLlm.generate', () => {
  beforeEach(() => { /* per-test fetch setup */ });

  it('sends model + prompt to /api/generate', async () => {
    f = mockFetch({ ok: true, body: { response: 'hi' } });
    const llm = new OllamaChatLlm({ model: 'deepseek-coder:33b' });

    await llm.generate('say hi');

    const [url, init] = f.mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:11434/api/generate');
    const body = JSON.parse(init.body as string) as { model: string; prompt: string };
    expect(body.model).toBe('deepseek-coder:33b');
    expect(body.prompt).toBe('say hi');
  });

  it('returns the trimmed response field from Ollama', async () => {
    f = mockFetch({ ok: true, body: { response: '  hello world  ' } });
    const llm = new OllamaChatLlm({ model: 'm' });

    expect(await llm.generate('q')).toBe('hello world');
  });

  it('returns empty string when Ollama responds non-2xx', async () => {
    f = mockFetch({ ok: false, body: {} });
    const llm = new OllamaChatLlm({ model: 'm' });

    expect(await llm.generate('q')).toBe('');
  });

  it('returns empty string when response field is missing', async () => {
    f = mockFetch({ ok: true, body: {} });
    const llm = new OllamaChatLlm({ model: 'm' });

    expect(await llm.generate('q')).toBe('');
  });

  it('forwards temperature and num_predict from options', async () => {
    f = mockFetch({ ok: true, body: { response: '' } });
    const llm = new OllamaChatLlm({ model: 'm' });

    await llm.generate('q', { temperature: 0.7, maxTokens: 1024 });

    const [, init] = f.mock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { options: { temperature: number; num_predict: number } };
    expect(body.options.temperature).toBe(0.7);
    expect(body.options.num_predict).toBe(1024);
  });

  it('strips trailing slashes from the configured URL', async () => {
    f = mockFetch({ ok: true, body: { response: '' } });
    const llm = new OllamaChatLlm({ model: 'm', url: 'http://hub:11434/' });

    await llm.generate('q');

    const [url] = f.mock.mock.calls[0] as [string];
    expect(url).toBe('http://hub:11434/api/generate');
  });

  it('aborts the request when timeoutMs elapses', async () => {
    vi.useFakeTimers();
    const original = globalThis.fetch;
    let abortedSignal: AbortSignal | undefined;
    globalThis.fetch = vi.fn(
      // eslint-disable-next-line @typescript-eslint/promise-function-async -- never resolves
      (_url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        abortedSignal = init?.signal ?? undefined;
        return new Promise<Response>(() => { /* never resolves until abort */ });
      },
    ) as unknown as typeof fetch;
    const llm = new OllamaChatLlm({ model: 'm' });

    const promise = llm.generate('q', { timeoutMs: 50 });
    vi.advanceTimersByTime(60);
    await Promise.resolve();

    expect(abortedSignal?.aborted).toBe(true);
    f = { mock: globalThis.fetch as unknown as ReturnType<typeof vi.fn>, restore: () => { globalThis.fetch = original; vi.useRealTimers(); } };
    void promise.catch(() => { /* expected */ });
  });
});
