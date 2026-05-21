import type { IOllamaControl, PullError } from '../../core/ports/ollama-control.js';

export type EnsureEmbeddingModelResult =
  | { ok: true; alreadyPresent: boolean }
  | { ok: false; kind: PullError; details: string };

/**
 * Make sure the requested embedding model is available in Ollama.
 * If it's already in `ollama list` — return immediately. Otherwise
 * trigger `ollama pull` and stream progress through `onProgress`.
 */
export class EnsureEmbeddingModelUseCase {
  constructor(private readonly ollama: IOllamaControl) {}

  async execute(
    modelName: string,
    onProgress?: (pct: number, status: string) => void,
  ): Promise<EnsureEmbeddingModelResult> {
    const models = await this.ollama.listModels();
    const present = models.some((m) => m.name === modelName || m.name.startsWith(`${modelName}:`));
    if (present) {
      return { ok: true, alreadyPresent: true };
    }
    const result = await this.ollama.pullModel(modelName, onProgress);
    if (result.ok) {
      return { ok: true, alreadyPresent: false };
    }
    return { ok: false, kind: result.kind, details: result.details };
  }
}
