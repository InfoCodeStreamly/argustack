/**
 * Port: DockerControl — abstraction over docker / docker compose CLI.
 *
 * Implementations: CliDockerControl (shells out to `docker` and `docker compose`).
 * Core does not import child_process or any node API.
 */

export interface DockerVersion {
  readonly engine: string;
  readonly compose: string;
}

export type ComposeUpErrorKind =
  | 'permission'
  | 'compose-v1'
  | 'no-space'
  | 'port-in-use'
  | 'unknown';

export type ComposeUpResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly kind: ComposeUpErrorKind; readonly details: string };

/**
 * Port: Docker control surface used by init / bootstrap.
 *
 * @throws Error only on unrecoverable spawn failures.
 */
export interface IDockerControl {
  readonly name: string;

  /** True when the `docker` binary exists on PATH. */
  isInstalled(): Promise<boolean>;

  /** True when `docker info` succeeds (daemon reachable). */
  isRunning(): Promise<boolean>;

  /** Parsed engine + compose version, or null if `docker version` fails. */
  version(): Promise<DockerVersion | null>;

  /**
   * Poll `isRunning()` every `intervalMs` until true, up to `timeoutMs`.
   * Calls `onTick(secondsElapsed)` once per poll so callers can render progress.
   * Returns true when running, false on timeout.
   */
  pollUntilRunning(
    timeoutMs: number,
    intervalMs: number,
    onTick?: (secondsElapsed: number) => void,
  ): Promise<boolean>;

  /**
   * Run `docker compose up -d` in `cwd` against `composePath`.
   * Inspects stderr to classify common failure modes.
   */
  composeUp(composePath: string, cwd: string): Promise<ComposeUpResult>;
}
