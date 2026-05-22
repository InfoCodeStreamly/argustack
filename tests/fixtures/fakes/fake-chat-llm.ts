import type { IChatLlm, ChatGenerateOptions } from '../../../src/core/ports/chat-llm.js';

/**
 * In-memory `IChatLlm`. Default behaviour: every `generate` call
 * resolves to a canned string. Tests configure the response via
 * `setResponse` / `setResponses` or by mutating `response`.
 */
export class FakeChatLlm implements IChatLlm {
  readonly name = 'FakeChatLlm';

  response = '';
  private queue: string[] = [];

  readonly generateCalls: { prompt: string; options?: ChatGenerateOptions }[] = [];

  setResponse(reply: string): void {
    this.response = reply;
  }

  setResponses(replies: string[]): void {
    this.queue = [...replies];
  }

  async generate(prompt: string, options?: ChatGenerateOptions): Promise<string> {
    this.generateCalls.push(options !== undefined ? { prompt, options } : { prompt });
    const next = this.queue.shift();
    return Promise.resolve(next ?? this.response);
  }
}
