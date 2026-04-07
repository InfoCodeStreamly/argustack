import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { readConfig, getEnabledSources } from './config.js';
import type { SourceType } from '../core/types/index.js';

function registryDir(): string {
  return join(homedir(), '.argustack');
}

function registryFile(): string {
  return join(registryDir(), 'workspaces.json');
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

export function listRegisteredWorkspaces(activeRoot?: string): WorkspaceInfo[] {
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
      active: entry.path === activeRoot,
    });
  }

  if (live.length !== entries.length) {
    writeRegistry(live);
  }

  return workspaces;
}

export function pruneDeadWorkspaces(): void {
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
  if (!existsSync(registryDir())) {
    mkdirSync(registryDir(), { recursive: true });
  }
  writeFileSync(registryFile(), JSON.stringify(entries, null, 2) + '\n');
}
