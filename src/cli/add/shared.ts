import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import type { IWorkspaceStore } from '../../core/ports/workspace-store.js';
import type { WorkspaceSettings } from '../../core/types/index.js';
import { loadHubConfig, resetHubConfigCache, hubConfigPath } from '../../workspace/hub-config.js';
import { getActiveWorkspaceId } from '../../workspace/active-workspace.js';

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

/**
 * Resolve the `--workspace <name>` flag (or active workspace) to a hub
 * workspace id. Throws if no workspace is selected.
 */
export async function resolveWorkspaceFlag(
  store: IWorkspaceStore,
  explicit: string | undefined,
): Promise<string> {
  const trimmed = explicit?.trim();
  if (trimmed !== undefined && trimmed !== '') {
    const found = (await store.getById(trimmed)) ?? (await store.getByName(trimmed));
    if (found == null) {
      throw new Error(`Workspace "${trimmed}" not found. Run "argustack workspace list".`);
    }
    return found.id;
  }
  const activeId = getActiveWorkspaceId();
  if (activeId !== null && activeId !== '') {
    const found = await store.getById(activeId);
    if (found != null) {
      return found.id;
    }
  }
  const all = await store.list();
  if (all.length === 1 && all[0] != null) {
    return all[0].id;
  }
  throw new Error(
    'No workspace selected. Pass --workspace <name> or run "argustack workspace use <name>".',
  );
}

/**
 * Merge a single key into `workspaces.settings` JSONB. Top-level keys
 * replace whatever was there; arrays inside settings are replaced as a
 * whole — callers wanting append semantics should read the existing
 * list first.
 */
export async function patchWorkspaceSetting<K extends keyof WorkspaceSettings>(
  store: IWorkspaceStore,
  workspaceId: string,
  key: K,
  value: WorkspaceSettings[K],
): Promise<void> {
  await store.updateSettings(workspaceId, { [key]: value } as Partial<WorkspaceSettings>);
}

/**
 * Append values into a list-shaped setting (gitRepoPaths, jiraProjectKeys, etc.)
 * Deduplicated by stable JSON serialisation.
 */
export async function appendToListSetting<K extends keyof WorkspaceSettings>(
  store: IWorkspaceStore,
  workspaceId: string,
  key: K,
  values: NonNullable<WorkspaceSettings[K]>,
): Promise<void> {
  const workspace = await store.getById(workspaceId);
  const existing = (workspace?.settings?.[key] ?? []) as readonly unknown[];
  const seen = new Set(existing.map((v) => JSON.stringify(v)));
  const merged = [...existing];
  for (const v of values as readonly unknown[]) {
    const sig = JSON.stringify(v);
    if (!seen.has(sig)) {
      merged.push(v);
      seen.add(sig);
    }
  }
  await store.updateSettings(workspaceId, { [key]: merged } as Partial<WorkspaceSettings>);
}

/**
 * Upsert a single env var inside `~/.argustack/config.env`. Used by
 * `argustack add jira`/`add github` to record credentials shared across
 * workspaces. Existing entries are replaced; the file's other lines
 * (comments, unrelated keys) are preserved.
 */
export function upsertHubEnv(patch: Record<string, string>): void {
  const path = hubConfigPath();
  if (!existsSync(path)) {
    throw new Error(`Hub config not found at ${path}. Run "argustack init" first.`);
  }
  const original = readFileSync(path, 'utf-8');
  const lines = original.split('\n');
  const seen = new Set<string>();
  const updated = lines.map((line) => {
    const m = /^([A-Z_][A-Z0-9_]*)\s*=/.exec(line.trim());
    if (m == null) {
      return line;
    }
    const key = m[1];
    if (key !== undefined && key !== '' && key in patch) {
      seen.add(key);
      return `${key}=${patch[key]}`;
    }
    return line;
  });
  for (const [k, v] of Object.entries(patch)) {
    if (!seen.has(k)) {
      updated.push(`${k}=${v}`);
    }
  }
  writeFileSync(path, updated.join('\n'));
  try { chmodSync(path, 0o600); } catch { /* best-effort */ }
  resetHubConfigCache();
}
