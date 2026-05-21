import type { IWorkspaceStore } from '../../core/ports/workspace-store.js';
import { getActiveWorkspace, clearActiveWorkspace } from '../../workspace/active-workspace.js';

export type ClearStaleActiveResult =
  | { cleared: false; reason: 'no-active' | 'still-valid' }
  | { cleared: true; staleId: string };

/**
 * Re-init recovery: if `~/.argustack/active-workspace.json` points at
 * a workspace that no longer exists in the `workspaces` table (because
 * the user ran `argustack workspace remove` and didn't clean up the
 * pointer), wipe the stale file so resolution falls back to the list.
 */
export class ClearStaleActiveUseCase {
  constructor(private readonly hubStore: IWorkspaceStore) {}

  async execute(): Promise<ClearStaleActiveResult> {
    const active = getActiveWorkspace();
    if (!active) {
      return { cleared: false, reason: 'no-active' };
    }
    const existing = await this.hubStore.getById(active.activeWorkspaceId);
    if (existing) {
      return { cleared: false, reason: 'still-valid' };
    }
    clearActiveWorkspace();
    return { cleared: true, staleId: active.activeWorkspaceId };
  }
}
