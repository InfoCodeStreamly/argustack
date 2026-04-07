import dotenv from 'dotenv';
import { readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { findWorkspaceRoot } from '../workspace/resolver.js';
import { readConfig, getEnabledSources } from '../workspace/config.js';
import { listRegisteredWorkspaces } from '../workspace/registry.js';
import type { WorkspaceConfig, SourceType } from '../core/types/index.js';
import type { ISourceProvider } from '../core/ports/source-provider.js';
import type { IStorage } from '../core/ports/storage.js';
import type { ToolResponse } from './types.js';

export type WorkspaceResult =
  | { ok: true; root: string; config: WorkspaceConfig }
  | { ok: false; reason: string };

export interface WorkspaceListItem {
  name: string;
  path: string;
  sources: SourceType[];
  active: boolean;
}

let activeStorage: IStorage | null = null;

export function loadWorkspace(): WorkspaceResult {
  const envVar = process.env['ARGUSTACK_WORKSPACE'];
  const root = findWorkspaceRoot();

  if (!root) {
    const hint = envVar
      ? `ARGUSTACK_WORKSPACE is set to "${envVar}" but no .argustack/ marker found there or in parent directories.`
      : 'No ARGUSTACK_WORKSPACE env var set and no .argustack/ found from cwd.';
    return { ok: false, reason: hint };
  }

  const config = readConfig(root);
  if (!config) {
    return {
      ok: false,
      reason: `Workspace found at ${root} but .argustack/config.json is missing or invalid. Run "argustack init".`,
    };
  }

  return { ok: true, root, config };
}

/**
 * Switch to a different workspace by name.
 * Closes current storage connection, updates env, reloads .env.
 */
export async function switchWorkspace(name: string): Promise<WorkspaceResult> {
  const currentRoot = process.env['ARGUSTACK_WORKSPACE'];

  let targetDir: string | null = null;

  if (currentRoot) {
    const parentDir = dirname(currentRoot);
    const siblingDir = join(parentDir, name);
    if (existsSync(join(siblingDir, '.argustack'))) {
      targetDir = siblingDir;
    }
  }

  if (!targetDir) {
    const registered = listRegisteredWorkspaces(currentRoot ?? undefined);
    const match = registered.find((w) => w.name === name || basename(w.path) === name);
    if (match) {
      targetDir = match.path;
    }
  }

  if (!targetDir) {
    const available = listSiblingWorkspaces();
    const names = available.map((w) => w.name).join(', ');
    return {
      ok: false,
      reason: `Workspace '${name}' not found. Available: ${names || 'none'}`,
    };
  }

  if (activeStorage) {
    try {
      await activeStorage.close();
    } catch { /* ignore close errors */ }
    activeStorage = null;
  }

  process.env['ARGUSTACK_WORKSPACE'] = targetDir;

  const keysToRemove = Object.keys(process.env).filter((key) =>
    key.startsWith('JIRA_') || key.startsWith('GIT_') || key.startsWith('GITHUB_') ||
    key.startsWith('DB_') || key.startsWith('TARGET_DB_') || key.startsWith('CSV_') ||
    key === 'OPENAI_API_KEY',
  );
  for (const key of keysToRemove) {
    process.env[key] = undefined;
  }

  dotenv.config({ path: join(targetDir, '.env'), override: true });

  return loadWorkspace();
}

/**
 * Scan parent directory for sibling workspaces.
 */
export function listSiblingWorkspaces(): WorkspaceListItem[] {
  const currentRoot = process.env['ARGUSTACK_WORKSPACE'];
  if (!currentRoot) {
    return [];
  }

  const parentDir = dirname(currentRoot);
  const currentName = basename(currentRoot);

  let entries: string[];
  try {
    entries = readdirSync(parentDir);
  } catch {
    return [];
  }

  const workspaces: WorkspaceListItem[] = [];

  for (const name of entries) {
    if (name.startsWith('.')) {
      continue;
    }

    const subdir = join(parentDir, name);
    try {
      if (!statSync(subdir).isDirectory()) {
        continue;
      }
    } catch {
      continue;
    }

    if (!existsSync(join(subdir, '.argustack'))) {
      continue;
    }

    const config = readConfig(subdir);
    if (!config) {
      continue;
    }

    workspaces.push({
      name: config.name ?? name,
      path: subdir,
      sources: getEnabledSources(config),
      active: name === currentName,
    });
  }

  const registered = listRegisteredWorkspaces(currentRoot);
  for (const rw of registered) {
    const alreadyListed = workspaces.some((w) => w.path === rw.path);
    if (!alreadyListed) {
      workspaces.push(rw);
    }
  }

  return workspaces;
}

export function setActiveStorage(storage: IStorage): void {
  activeStorage = storage;
}

export function getActiveStorage(): IStorage | null {
  return activeStorage;
}

export async function createAdapters(workspaceRoot: string): Promise<{
  source: ISourceProvider | null;
  storage: IStorage;
}> {
  dotenv.config({ path: `${workspaceRoot}/.env`, quiet: true });

  const { JIRA_URL, JIRA_EMAIL, JIRA_API_TOKEN } = process.env;
  const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME } = process.env;

  let source: ISourceProvider | null = null;

  const wsConfig = readConfig(workspaceRoot);
  const issueTypes = wsConfig?.sources.jira?.issueTypes;

  const { proxyConfigExists, loadProxyConfig, ProxyJiraProvider } = await import('../adapters/jira-proxy/index.js');
  if (proxyConfigExists(workspaceRoot)) {
    const proxyConfig = loadProxyConfig(workspaceRoot);
    source = new ProxyJiraProvider(proxyConfig, issueTypes);
  } else if (JIRA_URL && JIRA_EMAIL && JIRA_API_TOKEN) {
    const { JiraProvider } = await import('../adapters/jira/index.js');
    source = new JiraProvider({
      host: JIRA_URL,
      email: JIRA_EMAIL,
      apiToken: JIRA_API_TOKEN,
    }, issueTypes);
  }

  const { PostgresStorage } = await import('../adapters/postgres/index.js');
  const storage: IStorage = new PostgresStorage({
    host: DB_HOST ?? 'localhost',
    port: parseInt(DB_PORT ?? '5434', 10),
    user: DB_USER ?? 'argustack',
    password: DB_PASSWORD ?? 'argustack_local',
    database: DB_NAME ?? 'argustack',
  });

  return { source, storage };
}

export function textResponse(text: string): ToolResponse {
  return { content: [{ type: 'text' as const, text }] };
}

export function errorResponse(text: string): ToolResponse {
  return { content: [{ type: 'text' as const, text }], isError: true };
}

export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

export function str(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return JSON.stringify(value);
}

export { getEnabledSources };
