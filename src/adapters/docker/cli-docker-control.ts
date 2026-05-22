import type { IPlatformProbe } from '../../core/ports/platform-probe.js';
import type {
  IDockerControl,
  DockerVersion,
  ComposeUpResult,
  ComposeUpErrorKind,
} from '../../core/ports/docker-control.js';

export class CliDockerControl implements IDockerControl {
  readonly name = 'CliDockerControl';

  constructor(private readonly platform: IPlatformProbe) {}

  async isInstalled(): Promise<boolean> {
    return this.platform.hasCommand('docker');
  }

  async isRunning(): Promise<boolean> {
    const result = await this.platform.runCommand('docker', ['info']);
    return result.code === 0;
  }

  async version(): Promise<DockerVersion | null> {
    const engine = await this.platform.runCommand('docker', ['version', '--format', '{{.Server.Version}}']);
    if (engine.code !== 0) {
      return null;
    }
    const compose = await this.platform.runCommand('docker', ['compose', 'version', '--short']);
    if (compose.code !== 0) {
      return null;
    }
    return {
      engine: engine.stdout.trim(),
      compose: compose.stdout.trim(),
    };
  }

  async pollUntilRunning(
    timeoutMs: number,
    intervalMs: number,
    onTick?: (secondsElapsed: number) => void,
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    let elapsed = 0;
    while (Date.now() < deadline) {
      if (await this.isRunning()) {
        return true;
      }
      onTick?.(elapsed);
      await new Promise((r) => setTimeout(r, intervalMs));
      elapsed += Math.round(intervalMs / 1000);
    }
    return this.isRunning();
  }

  async composeUp(composePath: string, cwd: string): Promise<ComposeUpResult> {
    void cwd;
    const result = await this.platform.runCommand(
      'docker',
      ['compose', '-f', composePath, 'up', '-d'],
    );
    if (result.code === 0) {
      return { ok: true };
    }
    return {
      ok: false,
      kind: classifyComposeError(result.stderr),
      details: result.stderr.trim() !== '' ? result.stderr.trim() : result.stdout.trim(),
    };
  }
}

function classifyComposeError(stderr: string): ComposeUpErrorKind {
  const lower = stderr.toLowerCase();
  if (lower.includes('permission denied') || lower.includes('eacces')) {
    return 'permission';
  }
  if (lower.includes('no space left') || lower.includes('disk space')) {
    return 'no-space';
  }
  if (lower.includes('address already in use') || lower.includes('port is already allocated')) {
    return 'port-in-use';
  }
  if (lower.includes('not supported') && lower.includes('compose')) {
    return 'compose-v1';
  }
  return 'unknown';
}
