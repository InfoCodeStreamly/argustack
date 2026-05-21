import type { IPlatformProbe, PortInUse, PortStatus } from '../../core/ports/platform-probe.js';

export type CheckPortsResult =
  | { free: true }
  | { free: false; conflicts: readonly PortInUse[] };

/**
 * Check that the hub-stack ports are not occupied by other processes.
 * Returns the full list of conflicts so the caller can show all of
 * them at once (instead of one-by-one).
 */
export class CheckPortsUseCase {
  constructor(private readonly platform: IPlatformProbe) {}

  async execute(ports: readonly number[]): Promise<CheckPortsResult> {
    const conflicts: PortInUse[] = [];
    for (const port of ports) {
      const status: PortStatus = await this.platform.checkPort(port);
      if (!status.free) {
        conflicts.push(status);
      }
    }
    if (conflicts.length === 0) {
      return { free: true };
    }
    return { free: false, conflicts };
  }
}
