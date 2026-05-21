import type { IDockerControl } from '../../core/ports/docker-control.js';

export interface WaitForDockerOptions {
  readonly timeoutMs?: number;
  readonly intervalMs?: number;
  readonly onTick?: (secondsElapsed: number) => void;
}

const DEFAULT_TIMEOUT_MS = 600_000;
const DEFAULT_INTERVAL_MS = 5_000;

/**
 * Block until `docker info` answers, polling every `intervalMs`.
 * Returns true if docker came up before timeout; false on timeout.
 */
export class WaitForDockerUseCase {
  constructor(private readonly docker: IDockerControl) {}

  execute(options: WaitForDockerOptions = {}): Promise<boolean> {
    return this.docker.pollUntilRunning(
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      options.intervalMs ?? DEFAULT_INTERVAL_MS,
      options.onTick,
    );
  }
}
