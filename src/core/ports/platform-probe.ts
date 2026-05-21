/**
 * Port: PlatformProbe — abstraction over OS detection and process spawning.
 *
 * Implementations: NodePlatformProbe (uses child_process + node:os).
 * Core knows nothing about Node APIs or shell commands.
 */

export type OsKind = 'macos' | 'linux' | 'windows' | 'unknown';

export interface PortFree {
  readonly free: true;
  readonly port: number;
}

export interface PortInUse {
  readonly free: false;
  readonly port: number;
  readonly pid: number;
  readonly processName: string;
}

export type PortStatus = PortFree | PortInUse;

export interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

/**
 * Port: low-level OS probe + process control used by init/preflight.
 * Implementations should never throw for non-zero exit — return CommandResult instead.
 *
 * @throws Error only on unrecoverable I/O failures (spawn failed).
 */
export interface IPlatformProbe {
  readonly name: string;

  detectOS(): OsKind;

  /** True when `which <cmd>` (or equivalent) succeeds. */
  hasCommand(command: string): Promise<boolean>;

  /**
   * Check if a TCP port is currently bound by a listening socket.
   * Implementations on POSIX use `lsof -iTCP:N -sTCP:LISTEN`.
   * On unknown OS may return `{ free: true }` optimistically.
   */
  checkPort(port: number): Promise<PortStatus>;

  /**
   * Run a command and return its stdout/stderr/code.
   * Does not throw on non-zero exit — caller inspects `code`.
   */
  runCommand(command: string, args: readonly string[]): Promise<CommandResult>;
}
