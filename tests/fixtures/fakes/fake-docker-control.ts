import type {
  IDockerControl,
  DockerVersion,
  ComposeUpResult,
} from '../../../src/core/ports/docker-control.js';

/**
 * In-memory `IDockerControl` for use-case tests. All probes default to
 * a healthy environment. Configure failure modes via the public
 * `installed`, `running`, `composeResult` setters.
 */
export class FakeDockerControl implements IDockerControl {
  readonly name = 'FakeDockerControl';

  installed = true;
  running = true;
  versionInfo: DockerVersion | null = { engine: '24.0.0', compose: '2.20.0' };
  composeResult: ComposeUpResult = { ok: true };

  readonly composeUpCalls: { composePath: string; cwd: string }[] = [];
  readonly pollUntilRunningCalls: { timeoutMs: number; intervalMs: number }[] = [];

  async isInstalled(): Promise<boolean> {
    return Promise.resolve(this.installed);
  }

  async isRunning(): Promise<boolean> {
    return Promise.resolve(this.running);
  }

  async version(): Promise<DockerVersion | null> {
    return Promise.resolve(this.versionInfo);
  }

  async pollUntilRunning(
    timeoutMs: number,
    intervalMs: number,
    onTick?: (secondsElapsed: number) => void,
  ): Promise<boolean> {
    this.pollUntilRunningCalls.push({ timeoutMs, intervalMs });
    onTick?.(0);
    return Promise.resolve(this.running);
  }

  async composeUp(composePath: string, cwd: string): Promise<ComposeUpResult> {
    this.composeUpCalls.push({ composePath, cwd });
    return Promise.resolve(this.composeResult);
  }
}
