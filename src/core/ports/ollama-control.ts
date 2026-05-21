/**
 * Port: OllamaControl — abstraction over Ollama install / serve / pull / probe.
 *
 * Implementations: HttpOllamaControl (talks to http://localhost:11434 + shells `ollama`).
 */

export type InstallError = 'no-brew' | 'no-curl' | 'permission' | 'no-internet' | 'unknown';

export type InstallResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly kind: InstallError; readonly details: string };

export type PullError = 'no-internet' | 'no-space' | 'hub-down' | 'unknown';

export type PullResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly kind: PullError; readonly details: string };

export type ProbeError = 'no-response' | 'wrong-format' | 'model-not-found' | 'timeout';

export type ProbeResult =
  | { readonly ok: true; readonly dims: number }
  | { readonly ok: false; readonly kind: ProbeError; readonly details: string };

export interface OllamaModel {
  readonly name: string;
  readonly sizeBytes: number;
}

/**
 * Port: Ollama lifecycle used by init/setup-llm.
 *
 * @throws Error only on unrecoverable I/O.
 */
export interface IOllamaControl {
  readonly name: string;

  isInstalled(): Promise<boolean>;
  isRunning(): Promise<boolean>;
  version(): Promise<string | null>;

  installViaBrew(): Promise<InstallResult>;
  installViaCurl(): Promise<InstallResult>;

  /**
   * Spawn `ollama serve` detached and return immediately.
   * Use {@link waitHealthy} to block until the HTTP API responds.
   */
  startInBackground(): Promise<void>;

  waitHealthy(timeoutMs: number): Promise<boolean>;

  listModels(): Promise<OllamaModel[]>;

  pullModel(name: string, onProgress?: (pct: number, status: string) => void): Promise<PullResult>;

  /**
   * Send a one-shot embedding request to verify the model works.
   * Returns the response vector dimensions or a classified failure.
   */
  probeEmbedding(model: string, text: string, url?: string): Promise<ProbeResult>;
}
