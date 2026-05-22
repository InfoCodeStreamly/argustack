import { existsSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import type { IWorkspaceStore } from '../core/ports/workspace-store.js';
import { getActiveWorkspaceId } from './active-workspace.js';

const WORKSPACE_MARKER = '.argustack';
const LEGACY_CONFIG = 'config.json';

interface LegacyConfigFile {
  workspaceId?: string;
  name?: string;
}

/**
 * Resolve which workspace a command should operate on.
 *
 * Resolution order:
 *   1. `explicit` argument (e.g. `--workspace <name>` flag value).
 *   2. `ARGUSTACK_WORKSPACE_ID` env var.
 *   3. `~/.argustack/active-workspace.json#activeWorkspaceId`.
 *   4. Legacy `<cwd>/../.../.argustack/config.json#workspaceId` walking up.
 *   5. If exactly one workspace exists in the hub — auto-pick it.
 *   6. Otherwise: throw with the available list.
 *
 * The returned id is guaranteed to be a non-empty string and to exist in
 * the hub `workspaces` table at the moment of resolution.
 */
export async function requireWorkspaceId(
  explicit: string | undefined,
  hubStore: IWorkspaceStore,
): Promise<string> {
  const fromExplicit = await resolveExplicit(explicit, hubStore);
  if (fromExplicit !== null && fromExplicit !== '') {
    return fromExplicit;
  }

  const envId = process.env['ARGUSTACK_WORKSPACE_ID'];
  if (envId !== undefined && envId.trim().length > 0) {
    const found = await hubStore.getById(envId.trim());
    if (found != null) {
      return found.id;
    }
    throw new Error(
      `ARGUSTACK_WORKSPACE_ID="${envId}" not found in hub. Run "argustack workspace list" to see registered workspaces.`,
    );
  }

  const activeId = getActiveWorkspaceId();
  if (activeId !== null && activeId !== '') {
    const found = await hubStore.getById(activeId);
    if (found != null) {
      return found.id;
    }
  }

  const legacyId = findLegacyWorkspaceId(process.cwd());
  if (legacyId !== null && legacyId !== '') {
    const found = await hubStore.getById(legacyId);
    if (found != null) {
      return found.id;
    }
  }

  const all = await hubStore.list();
  if (all.length === 1) {
    const onlyEntry = all[0];
    if (onlyEntry != null) {
      return onlyEntry.id;
    }
  }

  if (all.length === 0) {
    throw new Error(
      'No workspaces registered. Run "argustack workspace add <name>" to create one.',
    );
  }

  const names = all.map((w) => w.name).join(', ');
  throw new Error(
    `No active workspace. Pass --workspace <name>, or run "argustack workspace use <name>". ` +
    `Available: ${names}.`,
  );
}

async function resolveExplicit(
  explicit: string | undefined,
  hubStore: IWorkspaceStore,
): Promise<string | null> {
  if (explicit === undefined || explicit.trim().length === 0) {
    return null;
  }
  const trimmed = explicit.trim();
  const byId = await hubStore.getById(trimmed);
  if (byId != null) {
    return byId.id;
  }
  const byName = await hubStore.getByName(trimmed);
  if (byName != null) {
    return byName.id;
  }
  throw new Error(
    `Workspace "${trimmed}" not found. Run "argustack workspace list" to see registered workspaces.`,
  );
}

/**
 * Walk up from `startDir` looking for `.argustack/config.json#workspaceId`.
 * Pre-hub workspaces stored the id there; we keep reading it during the
 * transition so old per-folder workflows resolve to the hub-side row.
 */
export function findLegacyWorkspaceId(startDir: string): string | null {
  let dir = resolve(startDir);
  while (true) {
    const cfg = join(dir, WORKSPACE_MARKER, LEGACY_CONFIG);
    if (existsSync(cfg)) {
      try {
        const parsed = JSON.parse(readFileSync(cfg, 'utf-8')) as LegacyConfigFile;
        if (typeof parsed.workspaceId === 'string' && parsed.workspaceId.length > 0) {
          return parsed.workspaceId;
        }
        if (typeof parsed.name === 'string' && parsed.name.length > 0) {
          return parsed.name;
        }
      } catch {
        /* malformed legacy config — skip */
      }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

/**
 * Walk up from `startDir` looking for a legacy `.argustack/` directory.
 * Used by `argustack migrate-to-hub` to find source workspaces, NOT by
 * normal command resolution.
 */
export function findLegacyWorkspaceRoot(startDir?: string): string | null {
  let dir = resolve(startDir ?? process.cwd());
  while (true) {
    if (existsSync(join(dir, WORKSPACE_MARKER, LEGACY_CONFIG))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}
