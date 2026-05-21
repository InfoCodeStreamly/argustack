import dotenv from 'dotenv';
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { homedir } from 'node:os';
import { findWorkspaceRoot } from '../workspace/resolver.js';
import { readConfig, getEnabledSources } from '../workspace/config.js';
import { listRegisteredWorkspaces } from '../workspace/registry.js';
import type { WorkspaceConfig, SourceType } from '../core/types/index.js';
import type { ISourceProvider } from '../core/ports/source-provider.js';
import type { IStorage } from '../core/ports/storage.js';
import type { ICodeGraph } from '../core/ports/code-graph.js';
import type { ICodeVectorStore } from '../core/ports/code-vector-store.js';
import type { ICodeParser } from '../core/ports/code-parser.js';
import type { ICodeEmbedding } from '../core/ports/code-embedding.js';
import type { ICodeMetaStore } from '../core/ports/code-meta.js';
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
let overrideWorkspaceRoot: string | null = null;
let initialEnvWorkspace: string | null = null;
let initialEnvCaptured = false;

interface ActiveWorkspaceSwitch {
  switchedTo: string;
  switchedAt: string;
}

function getActiveWsFile(): string {
  return join(homedir(), '.argustack', 'active-workspace.json');
}

function persistWorkspaceSwitch(fromPath: string, toPath: string): void {
  const dir = join(homedir(), '.argustack');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  let data: Record<string, ActiveWorkspaceSwitch> = {};
  const filePath = getActiveWsFile();
  if (existsSync(filePath)) {
    try {
      data = JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, ActiveWorkspaceSwitch>;
    } catch { /* start fresh */ }
  }

  data[fromPath] = { switchedTo: toPath, switchedAt: new Date().toISOString() };
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
}

function getPersistedWorkspaceSwitch(fromPath: string): string | null {
  const filePath = getActiveWsFile();
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, ActiveWorkspaceSwitch>;
    const entry = data[fromPath];
    if (entry?.switchedTo && existsSync(join(entry.switchedTo, '.argustack'))) {
      return entry.switchedTo;
    }
  } catch { /* ignore */ }
  return null;
}

function clearPersistedWorkspaceSwitch(fromPath: string): void {
  const filePath = getActiveWsFile();
  if (!existsSync(filePath)) {
    return;
  }
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, ActiveWorkspaceSwitch>;
    Reflect.deleteProperty(data, fromPath);
    writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
  } catch { /* ignore */ }
}

export function loadWorkspace(): WorkspaceResult {
  if (!initialEnvCaptured) {
    initialEnvWorkspace = process.env['ARGUSTACK_WORKSPACE'] ?? null;
    initialEnvCaptured = true;

    if (initialEnvWorkspace && !overrideWorkspaceRoot) {
      const persisted = getPersistedWorkspaceSwitch(initialEnvWorkspace);
      if (persisted) {
        overrideWorkspaceRoot = persisted;
      }
    }
  }

  if (overrideWorkspaceRoot) {
    const config = readConfig(overrideWorkspaceRoot);
    if (config) {
      return { ok: true, root: overrideWorkspaceRoot, config };
    }
    overrideWorkspaceRoot = null;
    if (initialEnvWorkspace) {
      clearPersistedWorkspaceSwitch(initialEnvWorkspace);
    }
  }

  const envVar = process.env['ARGUSTACK_WORKSPACE'];
  const root = findWorkspaceRoot();

  if (!root) {
    if (envVar) {
      return {
        ok: false,
        reason: `ARGUSTACK_WORKSPACE is set to "${envVar}" but no .argustack/ marker found there or in parent directories.`,
      };
    }
    const registered = listRegisteredWorkspaces();
    if (registered.length > 0) {
      const names = registered.map((w) => w.name).join(', ');
      return {
        ok: false,
        reason: `Workspace not found from current directory. Available workspaces: ${names}. Use switch_workspace("name") to connect.`,
      };
    }
    return { ok: false, reason: 'No workspaces found. Run "argustack init" to create one.' };
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
  const currentRoot = overrideWorkspaceRoot ?? process.env['ARGUSTACK_WORKSPACE'];

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

  overrideWorkspaceRoot = targetDir;
  process.env['ARGUSTACK_WORKSPACE'] = targetDir;

  if (initialEnvWorkspace) {
    if (targetDir === initialEnvWorkspace) {
      clearPersistedWorkspaceSwitch(initialEnvWorkspace);
      overrideWorkspaceRoot = null;
    } else {
      persistWorkspaceSwitch(initialEnvWorkspace, targetDir);
    }
  }

  const keysToRemove = Object.keys(process.env).filter((key) =>
    key.startsWith('JIRA_') || key.startsWith('GIT_') || key.startsWith('GITHUB_') ||
    key.startsWith('DB_') || key.startsWith('TARGET_DB_') || key.startsWith('CSV_') ||
    key === 'OPENAI_API_KEY',
  );
  for (const key of keysToRemove) {
    Reflect.deleteProperty(process.env, key);
  }

  dotenv.config({ path: join(targetDir, '.env'), override: true });

  return loadWorkspace();
}

/**
 * Scan parent directory for sibling workspaces.
 */
export function listSiblingWorkspaces(): WorkspaceListItem[] {
  const currentRoot = overrideWorkspaceRoot ?? process.env['ARGUSTACK_WORKSPACE'];
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
  dotenv.config({ path: `${workspaceRoot}/.env`, override: true });

  const { JIRA_URL, JIRA_EMAIL, JIRA_API_TOKEN } = process.env;
  const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME } = process.env;

  let source: ISourceProvider | null = null;

  const wsConfig = readConfig(workspaceRoot);
  const issueTypes = wsConfig?.sources.jira?.issueTypeIds;

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

export interface CodeAdapters {
  graph: ICodeGraph;
  vec: ICodeVectorStore;
  parser: ICodeParser;
  embedding: ICodeEmbedding;
  meta: ICodeMetaStore;
  storage: IStorage & ICodeMetaStore;
}

let activeCodeAdapters: CodeAdapters | null = null;

export function setActiveCodeAdapters(adapters: CodeAdapters | null): void {
  activeCodeAdapters = adapters;
}

export function getActiveCodeAdapters(): CodeAdapters | null {
  return activeCodeAdapters;
}

/**
 * Build adapters needed by code-intelligence MCP tools.
 * Returns null if env is missing required vars (NEO4J_URI, QDRANT_URL,
 * VOYAGE_API_KEY). Caller must report the error to the user via errorResponse.
 */
export async function createCodeAdapters(workspaceRoot: string): Promise<CodeAdapters | null> {
  if (activeCodeAdapters) {
    return activeCodeAdapters;
  }
  dotenv.config({ path: `${workspaceRoot}/.env`, override: false });

  const {
    NEO4J_URI,
    NEO4J_USER,
    NEO4J_PASSWORD,
    QDRANT_URL,
    QDRANT_API_KEY,
    VOYAGE_API_KEY,
    LMSTUDIO_URL,
    EMBEDDING_MODEL,
    EMBEDDING_DIMS,
    CODE_EMBEDDING_PROVIDER,
    RERANK_MODEL,
  } = process.env;

  if (!NEO4J_URI || !QDRANT_URL) {
    return null;
  }

  const provider = (CODE_EMBEDDING_PROVIDER ?? 'lmstudio').toLowerCase();
  if (provider === 'voyage' && !VOYAGE_API_KEY) {
    return null;
  }

  const { PostgresStorage } = await import('../adapters/postgres/index.js');
  const { Neo4jCodeGraphStore } = await import('../adapters/neo4j/index.js');
  const { QdrantCodeVectorStore } = await import('../adapters/qdrant/index.js');
  const { TreeSitterParser } = await import('../adapters/tree-sitter/index.js');

  const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME } = process.env;
  const storage = new PostgresStorage({
    host: DB_HOST ?? 'localhost',
    port: parseInt(DB_PORT ?? '5434', 10),
    user: DB_USER ?? 'argustack',
    password: DB_PASSWORD ?? 'argustack_local',
    database: DB_NAME ?? 'argustack',
  });
  const graph = new Neo4jCodeGraphStore({
    uri: NEO4J_URI,
    user: NEO4J_USER ?? 'neo4j',
    password: NEO4J_PASSWORD ?? 'argustack_local',
  });
  const qdrantOpts: ConstructorParameters<typeof QdrantCodeVectorStore>[0] = {
    url: QDRANT_URL,
  };
  if (QDRANT_API_KEY) {
    qdrantOpts.apiKey = QDRANT_API_KEY;
  }
  const vec = new QdrantCodeVectorStore(qdrantOpts);
  const parser = new TreeSitterParser({ projectRoot: workspaceRoot });

  let embedding: ICodeEmbedding;
  if (provider === 'voyage' && VOYAGE_API_KEY) {
    const { VoyageCodeEmbeddingProvider } = await import('../adapters/voyage/index.js');
    embedding = new VoyageCodeEmbeddingProvider({ apiKey: VOYAGE_API_KEY });
  } else {
    const { LmStudioCodeEmbeddingProvider } = await import('../adapters/lmstudio/index.js');
    const lmsOpts: ConstructorParameters<typeof LmStudioCodeEmbeddingProvider>[0] = {};
    if (LMSTUDIO_URL) {lmsOpts.url = LMSTUDIO_URL;}
    if (EMBEDDING_MODEL) {lmsOpts.model = EMBEDDING_MODEL;}
    if (EMBEDDING_DIMS) {lmsOpts.dimensions = parseInt(EMBEDDING_DIMS, 10);}
    if (RERANK_MODEL) {lmsOpts.rerankModel = RERANK_MODEL;}
    embedding = new LmStudioCodeEmbeddingProvider(lmsOpts);
  }

  return { graph, vec, parser, embedding, meta: storage, storage };
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
