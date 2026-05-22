import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { IWorkspaceStore } from '../../core/ports/workspace-store.js';

export type HubCheckReason =
  | 'no-compose'
  | 'no-config-env'
  | 'db-unreachable';

export type CheckHubExistsResult =
  | { exists: true }
  | { exists: false; reason: HubCheckReason };

/**
 * Decide whether `argustack init` should run the bootstrap path or
 * the re-init path. Bootstrap is skipped only when ALL preconditions
 * are present:
 *   - `<hubDir>/docker-compose.yml` exists
 *   - `<hubDir>/config.env` exists
 *   - hub Postgres responds to a trivial query
 */
export class CheckHubExistsUseCase {
  constructor(
    private readonly hubDir: string,
    private readonly hubStore: IWorkspaceStore | null,
  ) {}

  async execute(): Promise<CheckHubExistsResult> {
    const composePath = join(this.hubDir, 'docker-compose.yml');
    if (!existsSync(composePath)) {
      return { exists: false, reason: 'no-compose' };
    }
    const configPath = join(this.hubDir, 'config.env');
    if (!existsSync(configPath)) {
      return { exists: false, reason: 'no-config-env' };
    }
    if (this.hubStore === null) {
      return { exists: false, reason: 'db-unreachable' };
    }
    try {
      await this.hubStore.list();
      return { exists: true };
    } catch {
      return { exists: false, reason: 'db-unreachable' };
    }
  }
}
