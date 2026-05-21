import type { HubConfig } from '../../workspace/hub-config.js';
import type { ProbeLlmUseCase } from './probe-llm.js';

export type HealthCheckExistingLlmResult =
  | { configured: false }
  | { configured: true; healthy: true; dims: number }
  | { configured: true; healthy: false; details: string };

/**
 * Re-init flow: if the hub already has an LLM provider configured,
 * do a single quick probe to make sure it still works. Used to warn
 * the user that their LM Studio is down / model was deleted, with
 * an offer to reconfigure.
 */
export class HealthCheckExistingLlmUseCase {
  constructor(private readonly probe: ProbeLlmUseCase) {}

  async execute(config: HubConfig): Promise<HealthCheckExistingLlmResult> {
    if (!config.embedding.userConfigured) {
      return { configured: false };
    }
    const url = resolveUrl(config);
    const model = config.embedding.model;
    if (!url || !model) {
      return { configured: false };
    }
    const result = await this.probe.execute({ url, model, retries: 1 });
    if (result.ok) {
      return { configured: true, healthy: true, dims: result.dims };
    }
    return { configured: true, healthy: false, details: `${result.kind}: ${result.details}` };
  }
}

function resolveUrl(config: HubConfig): string | null {
  switch (config.embedding.provider) {
    case 'ollama':
      return config.embedding.ollamaUrl ?? 'http://localhost:11434';
    case 'lmstudio':
      return config.embedding.lmstudioUrl ?? 'http://localhost:1234';
    case 'custom':
      return config.embedding.customUrl ?? null;
    case 'voyage':
      return null;
    default:
      return null;
  }
}
