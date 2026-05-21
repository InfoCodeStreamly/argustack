import type { IOllamaControl, ProbeError } from '../../core/ports/ollama-control.js';

export interface ProbeLlmInput {
  readonly url: string;
  readonly model: string;
  readonly retries?: number;
  readonly delayMs?: number;
}

export type ProbeLlmResult =
  | { ok: true; dims: number; attempts: number }
  | { ok: false; kind: ProbeError; details: string; attempts: number };

const DEFAULT_RETRIES = 3;
const DEFAULT_DELAY_MS = 5000;
const PROBE_TEXT = 'argustack-init-probe';

/**
 * Try to fetch an embedding from the given URL+model. Retries up to
 * `retries` times with a fixed delay so transient timeouts don't fail
 * the whole init.
 *
 * Works for any OpenAI-compatible /api/embeddings endpoint (Ollama,
 * LM Studio, llama-server). Internally calls `IOllamaControl.probeEmbedding`
 * which sends a POST to `${url}/api/embeddings`.
 */
export class ProbeLlmUseCase {
  constructor(private readonly ollama: IOllamaControl) {}

  async execute(input: ProbeLlmInput): Promise<ProbeLlmResult> {
    const retries = input.retries ?? DEFAULT_RETRIES;
    const delay = input.delayMs ?? DEFAULT_DELAY_MS;
    let attempts = 0;
    let lastKind: ProbeError = 'no-response';
    let lastDetails = '';

    while (attempts < retries) {
      attempts += 1;
      const result = await this.ollama.probeEmbedding(input.model, PROBE_TEXT, input.url);
      if (result.ok) {
        return { ok: true, dims: result.dims, attempts };
      }
      lastKind = result.kind;
      lastDetails = result.details;
      if (result.kind === 'model-not-found' || result.kind === 'wrong-format') {
        return { ok: false, kind: result.kind, details: result.details, attempts };
      }
      if (attempts < retries) {
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    return { ok: false, kind: lastKind, details: lastDetails, attempts };
  }
}
