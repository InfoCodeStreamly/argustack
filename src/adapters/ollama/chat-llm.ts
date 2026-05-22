import type { IChatLlm, ChatGenerateOptions } from '../../core/ports/chat-llm.js';

const DEFAULT_URL = 'http://localhost:11434';
const DEFAULT_MAX_TOKENS = 512;
const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_TIMEOUT_MS = 30_000;

interface OllamaChatConfig {
  readonly model: string;
  readonly url?: string;
}

interface OllamaGenerateResponse {
  readonly response?: string;
}

/**
 * Adapter: minimal Ollama chat client used for HyDE query expansion
 * and feature explanation. Stays on the `/api/generate` endpoint —
 * no streaming, no chat history — to keep the port surface narrow.
 *
 * The adapter swallows non-2xx responses by returning an empty string
 * instead of throwing, so callers can fall back to vector-only search
 * without try/catch noise. Transport-level errors (DNS, connection
 * refused) still propagate.
 */
export class OllamaChatLlm implements IChatLlm {
  readonly name = 'OllamaChatLlm';

  private readonly model: string;
  private readonly url: string;

  constructor(config: OllamaChatConfig) {
    this.model = config.model;
    this.url = (config.url ?? DEFAULT_URL).replace(/\/+$/, '');
  }

  async generate(prompt: string, options?: ChatGenerateOptions): Promise<string> {
    const controller = new AbortController();
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const timer = setTimeout(() => { controller.abort(); }, timeoutMs);
    try {
      const response = await fetch(`${this.url}/api/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt,
          stream: false,
          options: {
            temperature: options?.temperature ?? DEFAULT_TEMPERATURE,
            num_predict: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
          },
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        return '';
      }
      const parsed = (await response.json()) as OllamaGenerateResponse;
      return parsed.response?.trim() ?? '';
    } finally {
      clearTimeout(timer);
    }
  }
}
