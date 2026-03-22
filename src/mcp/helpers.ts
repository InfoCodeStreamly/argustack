import dotenv from 'dotenv';
import { findWorkspaceRoot } from '../workspace/resolver.js';
import { readConfig, getEnabledSources } from '../workspace/config.js';
import type { WorkspaceConfig } from '../core/types/index.js';
import type { ISourceProvider } from '../core/ports/source-provider.js';
import type { IStorage } from '../core/ports/storage.js';
import type { ToolResponse } from './types.js';

export type WorkspaceResult =
  | { ok: true; root: string; config: WorkspaceConfig }
  | { ok: false; reason: string };

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

export async function createAdapters(workspaceRoot: string): Promise<{
  source: ISourceProvider | null;
  storage: IStorage;
}> {
  dotenv.config({ path: `${workspaceRoot}/.env`, quiet: true });

  const { JIRA_URL, JIRA_EMAIL, JIRA_API_TOKEN } = process.env;
  const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME } = process.env;

  let source: ISourceProvider | null = null;

  if (JIRA_URL && JIRA_EMAIL && JIRA_API_TOKEN) {
    const { JiraProvider } = await import('../adapters/jira/index.js');
    source = new JiraProvider({
      host: JIRA_URL,
      email: JIRA_EMAIL,
      apiToken: JIRA_API_TOKEN,
    });
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
