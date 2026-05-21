import type { IOllamaControl } from '../../core/ports/ollama-control.js';

export type EnsureOllamaRunningResult =
  | { ok: true; alreadyRunning: boolean }
  | { ok: false; reason: 'timeout' };

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Make sure `ollama serve` is reachable on http://localhost:11434.
 * Starts the daemon in the background if it's not running, then
 * waits up to `timeoutMs` for the HTTP API to answer.
 */
export class EnsureOllamaRunningUseCase {
  constructor(private readonly ollama: IOllamaControl) {}

  async execute(timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<EnsureOllamaRunningResult> {
    if (await this.ollama.isRunning()) {
      return { ok: true, alreadyRunning: true };
    }
    await this.ollama.startInBackground();
    const healthy = await this.ollama.waitHealthy(timeoutMs);
    if (!healthy) {
      return { ok: false, reason: 'timeout' };
    }
    return { ok: true, alreadyRunning: false };
  }
}
