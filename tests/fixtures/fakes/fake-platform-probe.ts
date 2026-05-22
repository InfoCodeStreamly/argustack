import type {
  IPlatformProbe,
  OsKind,
  PortStatus,
  CommandResult,
} from '../../../src/core/ports/platform-probe.js';

/**
 * In-memory `IPlatformProbe`. Tests configure the OS, available
 * commands, port occupancy and canned command outputs via the public
 * setters and maps.
 */
export class FakePlatformProbe implements IPlatformProbe {
  readonly name = 'FakePlatformProbe';

  os: OsKind = 'macos';
  readonly availableCommands = new Set<string>(['docker', 'lsof']);
  readonly portState = new Map<number, PortStatus>();
  readonly commandResults = new Map<string, CommandResult>();

  readonly runCommandCalls: { command: string; args: readonly string[] }[] = [];

  detectOS(): OsKind {
    return this.os;
  }

  async hasCommand(command: string): Promise<boolean> {
    return Promise.resolve(this.availableCommands.has(command));
  }

  async checkPort(port: number): Promise<PortStatus> {
    const cached = this.portState.get(port);
    if (cached !== undefined) {
      return Promise.resolve(cached);
    }
    return Promise.resolve({ free: true, port });
  }

  async runCommand(command: string, args: readonly string[]): Promise<CommandResult> {
    this.runCommandCalls.push({ command, args });
    const key = `${command} ${args.join(' ')}`;
    const cached = this.commandResults.get(key);
    if (cached !== undefined) {
      return Promise.resolve(cached);
    }
    return Promise.resolve({ stdout: '', stderr: '', code: 0 });
  }
}
