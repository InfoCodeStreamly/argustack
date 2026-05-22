import type {
  IOllamaControl,
  InstallResult,
  PullResult,
  ProbeResult,
  OllamaModel,
} from '../../../src/core/ports/ollama-control.js';

/**
 * In-memory `IOllamaControl`. Default behaviour: Ollama is installed
 * and running, serves a 1024-dim embedding model, and brew/curl
 * installs succeed. Configure failure modes via the public setters.
 */
export class FakeOllamaControl implements IOllamaControl {
  readonly name = 'FakeOllamaControl';

  installed = true;
  running = true;
  versionString: string | null = '0.1.0';
  installResult: InstallResult = { ok: true };
  pullResult: PullResult = { ok: true };
  probeResult: ProbeResult = { ok: true, dims: 1024 };
  healthy = true;
  models: OllamaModel[] = [];

  readonly startCalls: number[] = [];
  readonly pullCalls: { name: string }[] = [];
  readonly probeCalls: { model: string; text: string; url?: string }[] = [];

  async isInstalled(): Promise<boolean> {
    return Promise.resolve(this.installed);
  }

  async isRunning(): Promise<boolean> {
    return Promise.resolve(this.running);
  }

  async version(): Promise<string | null> {
    return Promise.resolve(this.versionString);
  }

  async installViaBrew(): Promise<InstallResult> {
    return Promise.resolve(this.installResult);
  }

  async installViaCurl(): Promise<InstallResult> {
    return Promise.resolve(this.installResult);
  }

  async startInBackground(): Promise<void> {
    this.startCalls.push(Date.now());
    return Promise.resolve();
  }

  async waitHealthy(_timeoutMs: number): Promise<boolean> {
    return Promise.resolve(this.healthy);
  }

  async listModels(): Promise<OllamaModel[]> {
    return Promise.resolve([...this.models]);
  }

  async pullModel(
    name: string,
    onProgress?: (pct: number, status: string) => void,
  ): Promise<PullResult> {
    this.pullCalls.push({ name });
    onProgress?.(100, 'complete');
    return Promise.resolve(this.pullResult);
  }

  async probeEmbedding(model: string, text: string, url?: string): Promise<ProbeResult> {
    const call = url !== undefined ? { model, text, url } : { model, text };
    this.probeCalls.push(call);
    return Promise.resolve(this.probeResult);
  }
}
