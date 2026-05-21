import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { readConfig, getEnabledSources } from './config.js';
import type { SourceType, Workspace } from '../core/types/index.js';
import type { IWorkspaceStore } from '../core/ports/workspace-store.js';
import { hubDir } from './hub-config.js';

function registryFile(): string {
  return join(hubDir(), 'workspaces.json');
}

interface RegistryEntry {
  name: string;
  path: string;
  createdAt: string;
}

export interface WorkspaceInfo {
  name: string;
  path: string;
  sources: SourceType[];
  active: boolean;
}

/**
 * Append to the legacy `~/.argustack/workspaces.json` registry.
 *
 * Pre-hub Argustack maintained this file as the directory of per-folder
 * workspaces; the hub model derives the canonical list from the
 * `workspaces` table. We keep writing the legacy file during the
 * transition so `argustack migrate-to-hub` can discover legacy roots,
 * but it is best-effort — failures never block init/sync.
 */
export function registerWorkspace(workspacePath: string, name?: string): void {
  try {
    const entries = readRegistry();
    const existing = entries.find((e) => e.path === workspacePath);
    if (existing) {
      if (name && existing.name !== name) {
        existing.name = name;
        writeRegistry(entries);
      }
      return;
    }

    const wsName = name ?? workspacePath.split('/').pop() ?? 'unknown';
    entries.push({ name: wsName, path: workspacePath, createdAt: new Date().toISOString() });
    writeRegistry(entries);
  } catch {
    /* registry is best-effort — don't fail init/sync */
  }
}

/**
 * List legacy per-folder workspaces from `~/.argustack/workspaces.json`.
 * Used ONLY by `argustack migrate-to-hub`. Normal command flow uses
 * {@link listWorkspacesFromHub} instead.
 */
export function listLegacyWorkspaces(): WorkspaceInfo[] {
  const entries = readRegistry();
  const live: RegistryEntry[] = [];
  const workspaces: WorkspaceInfo[] = [];

  for (const entry of entries) {
    if (!existsSync(join(entry.path, '.argustack'))) {
      continue;
    }
    live.push(entry);

    const config = readConfig(entry.path);
    const sources = config ? getEnabledSources(config) : [];
    const displayName = config?.name ?? entry.name;

    workspaces.push({
      name: displayName,
      path: entry.path,
      sources,
      active: false,
    });
  }

  if (live.length !== entries.length) {
    writeRegistry(live);
  }

  return workspaces;
}

/**
 * Canonical workspace list — reads from the hub `workspaces` table.
 * Use this for `argustack workspace list` and all user-facing commands.
 */
export async function listWorkspacesFromHub(hubStore: IWorkspaceStore): Promise<Workspace[]> {
  return hubStore.list();
}

export function pruneDeadLegacyWorkspaces(): void {
  const entries = readRegistry();
  const live = entries.filter((e) => existsSync(join(e.path, '.argustack')));
  if (live.length !== entries.length) {
    writeRegistry(live);
  }
}

function readRegistry(): RegistryEntry[] {
  if (!existsSync(registryFile())) {
    return [];
  }
  try {
    const raw = readFileSync(registryFile(), 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as RegistryEntry[] : [];
  } catch {
    return [];
  }
}

function writeRegistry(entries: RegistryEntry[]): void {
  if (!existsSync(hubDir())) {
    mkdirSync(hubDir(), { recursive: true });
  }
  writeFileSync(registryFile(), JSON.stringify(entries, null, 2) + '\n');
}
