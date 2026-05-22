/**
 * Port contract tests for {@link IChatLlm}.
 * Verifies the FakeChatLlm satisfies the type and the canned-response
 * helpers behave as documented.
 */

import { describe, it, expect } from 'vitest';
import type { IChatLlm, ChatGenerateOptions } from '../../../../src/core/ports/chat-llm.js';
import { FakeChatLlm } from '../../../fixtures/fakes/fake-chat-llm.js';

describe('IChatLlm port contract', () => {
  it('FakeChatLlm satisfies IChatLlm interface', () => {
    const fake: IChatLlm = new FakeChatLlm();
    expect(fake.name).toBeTruthy();
    expect(typeof fake.generate).toBe('function');
  });

  it('returns the configured default response', async () => {
    const fake = new FakeChatLlm();
    fake.setResponse('hello');
    await expect(fake.generate('whatever')).resolves.toBe('hello');
  });

  it('serves queued responses in FIFO order, then falls back to default', async () => {
    const fake = new FakeChatLlm();
    fake.setResponse('default');
    fake.setResponses(['one', 'two']);

    expect(await fake.generate('q1')).toBe('one');
    expect(await fake.generate('q2')).toBe('two');
    expect(await fake.generate('q3')).toBe('default');
  });

  it('records every generate call with prompt and optional options', async () => {
    const fake = new FakeChatLlm();
    const opts: ChatGenerateOptions = { maxTokens: 100, temperature: 0.5 };

    await fake.generate('prompt1');
    await fake.generate('prompt2', opts);

    expect(fake.generateCalls).toEqual([
      { prompt: 'prompt1' },
      { prompt: 'prompt2', options: opts },
    ]);
  });
});
