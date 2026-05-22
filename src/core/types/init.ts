import type { DockerVersion } from '../ports/docker-control.js';
import type { PortStatus } from '../ports/platform-probe.js';

/**
 * Aggregate result of pre-bootstrap checks (versions + docker + ports + hub state).
 *
 * `hubExists` is true when both the compose file is present and the hub
 * Postgres schema is reachable. `null` means the check couldn't run
 * (e.g. docker still down).
 */
export interface PreflightResult {
  readonly nodeVersion: string;
  readonly docker: DockerVersion | null;
  readonly dockerRunning: boolean;
  readonly ports: readonly PortStatus[];
  readonly hubExists: boolean | null;
}

/**
 * Which LLM provider the init flow has selected and what to write to
 * `~/.argustack/config.env`. `custom` means the user supplied their own
 * URL + model (could be LM Studio, llama.cpp, anything OpenAI-compatible).
 */
export type LlmProvider = 'ollama' | 'custom';

export interface LlmSetupPlan {
  readonly provider: LlmProvider;
  readonly url: string;
  readonly model: string;
  readonly dimensions: number;
}
