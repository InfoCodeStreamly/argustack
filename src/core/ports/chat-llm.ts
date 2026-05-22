/**
 * Port: a minimal chat LLM used for query expansion (HyDE), feature
 * explanation, and similar one-shot prompts. Intentionally narrow —
 * Argustack does not host conversation history; each call is
 * independent.
 *
 * Implementations:
 *   - `OllamaChatLlm` — talks to a local Ollama instance.
 *   - In-memory test fakes return canned strings.
 *
 * Reliability contract:
 *   - `generate` MUST NOT throw on the model returning an empty
 *     string — return `''` instead. Throw only on transport failures
 *     (network, 5xx).
 *   - Callers fall back to a non-LLM path when the chat surface is
 *     unavailable, so the port should be optional in composition.
 */
export interface IChatLlm {
  readonly name: string;

  /**
   * Run a single prompt and return the model's reply.
   *
   * @param prompt   Full prompt text (no role separators).
   * @param options  Optional generation knobs.
   */
  generate(prompt: string, options?: ChatGenerateOptions): Promise<string>;
}

export interface ChatGenerateOptions {
  /** Cap response length (tokens). Defaults to adapter-specific value. */
  readonly maxTokens?: number;
  /** 0–1, lower = more deterministic. */
  readonly temperature?: number;
  /** Hard wall-clock timeout in ms; adapters should abort the request. */
  readonly timeoutMs?: number;
}
