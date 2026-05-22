import type { ISourceProvider } from '../core/ports/source-provider.js';
import type { IStorage } from '../core/ports/storage.js';
import type { ICodeGraph } from '../core/ports/code-graph.js';
import type { ICodeVectorStore } from '../core/ports/code-vector-store.js';
import type { ICodeParser } from '../core/ports/code-parser.js';
import type { ICodeEmbedding } from '../core/ports/code-embedding.js';
import type { ICodeMetaStore } from '../core/ports/code-meta.js';
import type { IChatLlm } from '../core/ports/chat-llm.js';
import type { IWorkspaceStore } from '../core/ports/workspace-store.js';
import type { Workspace, WorkspaceConfig } from '../core/types/index.js';
import { loadHubConfig } from '../workspace/hub-config.js';
import {
  getActiveWorkspace,
  setActiveWorkspace,
  clearActiveWorkspace,
} from '../workspace/active-workspace.js';
import { readWorkspaceConfigFromHub } from '../workspace/config.js';
import type { ToolResponse } from './types.js';

export interface WorkspaceContext {
  readonly workspaceId: string;
  readonly workspace: Workspace;
  readonly config: WorkspaceConfig;
}

export type WorkspaceResult =
  | { ok: true; workspaceId: string; workspace: Workspace; config: WorkspaceConfig }
  | { ok: false; reason: string };

let activeStorage: IStorage | null = null;
let activeWorkspaceStore: IWorkspaceStore | null = null;

interface CachedCodeAdapters {
  graph: ICodeGraph;
  vec: ICodeVectorStore;
  parser: ICodeParser;
  embedding: ICodeEmbedding;
  meta: ICodeMetaStore;
  storage: IStorage & ICodeMetaStore;
  chatLlm: IChatLlm | null;
  projectRoot: string;
}

export type CodeAdapters = Omit<CachedCodeAdapters, 'projectRoot'>;

let activeCodeAdapters: CachedCodeAdapters | null = null;

export function setActiveStorage(storage: IStorage): void {
  activeStorage = storage;
}

export function getActiveStorage(): IStorage | null {
  return activeStorage;
}

export function setActiveWorkspaceStore(store: IWorkspaceStore): void {
  activeWorkspaceStore = store;
}

export async function getWorkspaceStore(): Promise<IWorkspaceStore> {
  if (activeWorkspaceStore !== null) {
    return activeWorkspaceStore;
  }
  const { db } = loadHubConfig();
  const { PostgresWorkspaceStore, createPool } = await import('../adapters/postgres/index.js');
  const store = new PostgresWorkspaceStore(createPool(db));
  activeWorkspaceStore = store;
  return store;
}

/**
 * Resolve the workspace for a tool invocation.
 *
 * Resolution order (mirrors {@link import('../workspace/resolver').requireWorkspaceId}):
 *   1. `explicit` (the tool's `workspace_id` schema field).
 *   2. `ARGUSTACK_WORKSPACE_ID` env var.
 *   3. `~/.argustack/active-workspace.json#activeWorkspaceId`.
 *   4. Auto-pick when exactly one workspace exists in the hub.
 *
 * Returns a structured result so MCP tools can render a tool-friendly
 * error response instead of throwing.
 */
export async function loadWorkspace(explicit?: string): Promise<WorkspaceResult> {
  let store: IWorkspaceStore;
  try {
    store = await getWorkspaceStore();
  } catch (err) {
    return { ok: false, reason: getErrorMessage(err) };
  }

  const explicitId = explicit?.trim();
  if (explicitId !== undefined && explicitId.length > 0) {
    const workspace = (await store.getById(explicitId)) ?? (await store.getByName(explicitId));
    if (workspace === null) {
      return { ok: false, reason: `Workspace "${explicitId}" not found in hub.` };
    }
    return buildResult(workspace, store);
  }

  const envId = process.env['ARGUSTACK_WORKSPACE_ID']?.trim();
  if (envId !== undefined && envId.length > 0) {
    const workspace = await store.getById(envId);
    if (workspace === null) {
      return { ok: false, reason: `ARGUSTACK_WORKSPACE_ID="${envId}" not found in hub.` };
    }
    return buildResult(workspace, store);
  }

  const active = getActiveWorkspace();
  if (active !== null) {
    const workspace = await store.getById(active.activeWorkspaceId);
    if (workspace !== null) {
      return buildResult(workspace, store);
    }
    clearActiveWorkspace();
  }

  const all = await store.list();
  if (all.length === 1) {
    const only = all[0];
    if (only !== undefined) {
      return buildResult(only, store);
    }
  }

  if (all.length === 0) {
    return {
      ok: false,
      reason: 'No workspaces registered. Run "argustack workspace add <name>" to create one.',
    };
  }

  const names = all.map((w) => w.name).join(', ');
  return {
    ok: false,
    reason: `No active workspace. Pass workspace_id, or call switch_workspace. Available: ${names}.`,
  };
}

async function buildResult(workspace: Workspace, store: IWorkspaceStore): Promise<WorkspaceResult> {
  const config = await readWorkspaceConfigFromHub(workspace.id, store);
  if (config === null) {
    return { ok: false, reason: `Workspace "${workspace.id}" was not found after lookup.` };
  }
  return { ok: true, workspaceId: workspace.id, workspace, config };
}

/**
 * Switch the active workspace. Writes the hub `active-workspace.json`,
 * touches `last_active_at`, and resets cached connections so subsequent
 * tool calls reconnect with whatever per-workspace settings apply.
 */
export async function switchWorkspace(name: string): Promise<WorkspaceResult> {
  const store = await getWorkspaceStore();
  const workspace = (await store.getById(name)) ?? (await store.getByName(name));
  if (workspace === null) {
    const all = await store.list();
    const joined = all.map((w) => w.name).join(', ');
    const known = joined.length > 0 ? joined : 'none';
    return { ok: false, reason: `Workspace "${name}" not found. Available: ${known}` };
  }

  setActiveWorkspace(workspace.id, workspace.name);
  await store.touchActive(workspace.id);

  if (activeStorage !== null) {
    try { await activeStorage.close(); } catch { /* ignore */ }
    activeStorage = null;
  }
  if (activeCodeAdapters !== null) {
    try { await activeCodeAdapters.storage.close(); } catch { /* ignore */ }
    activeCodeAdapters = null;
  }

  return buildResult(workspace, store);
}

export interface ResolvedAdapters {
  source: ISourceProvider | null;
  storage: IStorage;
  workspaceId: string;
}

/**
 * Build the per-tool adapter set. The hub Postgres pool is reused
 * across invocations via {@link activeStorage}; the source provider
 * (Jira/proxy) is recreated each call since per-workspace project
 * filters can change.
 */
export async function createAdapters(workspaceId: string): Promise<ResolvedAdapters> {
  const hub = loadHubConfig();
  const store = await getWorkspaceStore();
  const workspace = await store.getById(workspaceId);
  if (workspace === null) {
    throw new Error(`Workspace "${workspaceId}" not found in hub.`);
  }

  if (activeStorage === null) {
    const { PostgresStorage } = await import('../adapters/postgres/index.js');
    activeStorage = new PostgresStorage(hub.db);
  }

  const issueTypeIds: string[] | undefined = undefined;

  let source: ISourceProvider | null = null;
  const { proxyConfigExistsForWorkspace, loadProxyConfigForWorkspace, ProxyJiraProvider } =
    await import('../adapters/jira-proxy/index.js');
  if (proxyConfigExistsForWorkspace(workspace.id)) {
    const proxyConfig = loadProxyConfigForWorkspace(workspace.id);
    source = new ProxyJiraProvider(proxyConfig, issueTypeIds);
  } else if (
    hasText(hub.credentials.jiraUrl)
    && hasText(hub.credentials.jiraEmail)
    && hasText(hub.credentials.jiraApiToken)
  ) {
    const { JiraProvider } = await import('../adapters/jira/index.js');
    source = new JiraProvider({
      host: hub.credentials.jiraUrl,
      email: hub.credentials.jiraEmail,
      apiToken: hub.credentials.jiraApiToken,
    }, issueTypeIds);
  }

  return { source, storage: activeStorage, workspaceId };
}

export function setActiveCodeAdapters(adapters: CodeAdapters | null): void {
  activeCodeAdapters = adapters !== null
    ? { ...adapters, projectRoot: '' }
    : null;
}

export function getActiveCodeAdapters(): CodeAdapters | null {
  return activeCodeAdapters;
}

/**
 * Build adapters used by code-intelligence MCP tools for a specific
 * workspace. Returns `null` if the hub config is missing the bits
 * required by the chosen embedding provider.
 */
export async function createCodeAdapters(workspaceId: string): Promise<CodeAdapters | null> {
  const hub = loadHubConfig();
  const store = await getWorkspaceStore();
  const workspace = await store.getById(workspaceId);
  if (workspace === null) {
    return null;
  }
  if (activeCodeAdapters !== null) {
    return activeCodeAdapters;
  }

  if (hub.embedding.provider === 'voyage' && !hasText(hub.embedding.voyageApiKey)) {
    return null;
  }

  const { PostgresStorage } = await import('../adapters/postgres/index.js');
  const { Neo4jCodeGraphStore } = await import('../adapters/neo4j/index.js');
  const { QdrantCodeVectorStore } = await import('../adapters/qdrant/index.js');
  const { TreeSitterParser } = await import('../adapters/tree-sitter/index.js');

  const storage = new PostgresStorage(hub.db);
  const graph = new Neo4jCodeGraphStore(hub.neo4j);
  const vec = new QdrantCodeVectorStore({ url: hub.qdrant.url });

  const projectRoot = workspace.settings?.gitRepoPaths?.[0] ?? hub.hubDir;
  const parser = new TreeSitterParser({ projectRoot });

  let embedding: ICodeEmbedding;
  if (hub.embedding.provider === 'voyage' && hasText(hub.embedding.voyageApiKey)) {
    const { VoyageCodeEmbeddingProvider } = await import('../adapters/voyage/index.js');
    embedding = new VoyageCodeEmbeddingProvider({ apiKey: hub.embedding.voyageApiKey });
  } else if (hub.embedding.provider === 'ollama' || hub.embedding.provider === 'custom') {
    const { OllamaCodeEmbeddingProvider } = await import('../adapters/ollama/index.js');
    const url = hub.embedding.provider === 'custom'
      ? hub.embedding.customUrl
      : hub.embedding.ollamaUrl;
    embedding = new OllamaCodeEmbeddingProvider({
      model: hub.embedding.model,
      dimensions: hub.embedding.dimensions,
      ...(hasText(url) ? { url } : {}),
    });
  } else {
    const { LmStudioCodeEmbeddingProvider } = await import('../adapters/lmstudio/index.js');
    const lmsOpts: ConstructorParameters<typeof LmStudioCodeEmbeddingProvider>[0] = {
      model: hub.embedding.model,
      dimensions: hub.embedding.dimensions,
    };
    if (hasText(hub.embedding.lmstudioUrl)) { lmsOpts.url = hub.embedding.lmstudioUrl; }
    if (hasText(hub.embedding.rerankModel)) { lmsOpts.rerankModel = hub.embedding.rerankModel; }
    embedding = new LmStudioCodeEmbeddingProvider(lmsOpts);
  }

  let chatLlm: IChatLlm | null = null;
  if (hub.chatLlm !== null) {
    if (hub.chatLlm.provider === 'ollama') {
      const { OllamaChatLlm } = await import('../adapters/ollama/index.js');
      chatLlm = new OllamaChatLlm({
        model: hub.chatLlm.model,
        ...(hasText(hub.chatLlm.url) ? { url: hub.chatLlm.url } : {}),
      });
    }
  }

  activeCodeAdapters = { graph, vec, parser, embedding, meta: storage, storage, chatLlm, projectRoot };
  return activeCodeAdapters;
}

/**
 * Annotation presets reused across MCP tool registrations.
 * Mirrors the `ToolAnnotations` shape from @modelcontextprotocol/sdk.
 *
 * - READ_ONLY    — pure query, no side effects, safe to retry.
 * - LOCAL_WRITE  — mutates hub-local state (board.md / Postgres rows),
 *                  no remote calls (e.g. create_issue with source='local').
 * - REMOTE_WRITE — pushes to or pulls from external systems (Jira, GitHub).
 *                  destructiveHint flips on so clients can warn the user
 *                  before invocation.
 */
export const ANNOTATIONS = {
  READ_ONLY: { readOnlyHint: true, idempotentHint: true, openWorldHint: false } as const,
  REMOTE_READ: { readOnlyHint: true, idempotentHint: true, openWorldHint: true } as const,
  LOCAL_WRITE: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const,
  REMOTE_WRITE: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true } as const,
} as const;

export function textResponse(text: string): ToolResponse {
  return { content: [{ type: 'text' as const, text }] };
}

export function errorResponse(text: string): ToolResponse {
  return { content: [{ type: 'text' as const, text }], isError: true };
}

/**
 * Standard "workspace not found" error response for MCP tools.
 *
 * Wraps the technical {@link WorkspaceResult.reason} in a UX-friendly
 * message that always contains the marker "Workspace not found" so
 * clients and tests can detect it regardless of which underlying
 * resolution step failed (no `.argustack/`, missing env var, unknown
 * id, etc.).
 */
export function workspaceNotFoundResponse(reason: string): ToolResponse {
  return errorResponse(
    `No Argustack workspace found (Workspace not found): ${reason}.\n` +
    'Run `argustack init` to create one, or pass workspace_id.',
  );
}

export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

/**
 * High-level helper: resolve workspace, build adapters, run callback.
 * Centralises the boilerplate for MCP tools that just need a scoped
 * `storage` and `workspaceId`.
 */
export async function withWorkspace<T>(
  explicit: string | undefined,
  fn: (ctx: { storage: IStorage; workspaceId: string; workspace: Workspace; config: WorkspaceConfig }) => Promise<T>,
): Promise<T | ToolResponse> {
  const ws = await loadWorkspace(explicit);
  if (!ws.ok) {
    return workspaceNotFoundResponse(ws.reason);
  }
  const { storage } = await createAdapters(ws.workspaceId);
  return fn({ storage, workspaceId: ws.workspaceId, workspace: ws.workspace, config: ws.config });
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

/**
 * Render `value` via {@link str}, but substitute `fallback` when the
 * result is the empty string. Replaces the deprecated `str(x) || 'N/A'`
 * pattern in a way that satisfies @typescript-eslint/strict-boolean-expressions.
 */
export function strOr(value: unknown, fallback: string): string {
  const result = str(value);
  return result.length > 0 ? result : fallback;
}

/**
 * Render a possibly-null/undefined string with a fallback.
 */
export function nullableStr(value: string | null | undefined, fallback: string): string {
  return value !== null && value !== undefined && value.length > 0 ? value : fallback;
}

/** True when `value` is a non-empty string. */
export function hasText(value: string | null | undefined): value is string {
  return value !== null && value !== undefined && value.length > 0;
}
