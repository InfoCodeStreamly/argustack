import type { IWorkspaceStore } from '../../core/ports/workspace-store.js';
import { loadHubConfig } from '../../workspace/hub-config.js';

export async function openHubStore(): Promise<{
  store: IWorkspaceStore;
  close: () => Promise<void>;
}> {
  const hub = loadHubConfig();
  const { PostgresWorkspaceStore, createPool } = await import('../../adapters/postgres/index.js');
  const pool = createPool(hub.db);
  const store = new PostgresWorkspaceStore(pool);
  return { store, close: async (): Promise<void> => { await pool.end(); } };
}

export function sanitizeSlug(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}
