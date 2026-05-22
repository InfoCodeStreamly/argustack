import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  setActiveCodeAdapters,
  setActiveWorkspaceStore,
  type CodeAdapters,
} from '../../../src/mcp/helpers.js';
import { FakeCodeGraph } from '../fakes/fake-code-graph.js';
import { FakeCodeVectorStore } from '../fakes/fake-code-vector-store.js';
import { FakeCodeMetaStore } from '../fakes/fake-code-meta-store.js';
import { FakeCodeEmbedding } from '../fakes/fake-code-embedding.js';
import { FakeCodeParser } from '../fakes/fake-code-parser.js';
import { FakeWorkspaceStore } from '../fakes/fake-workspace-store.js';
import type { IStorage } from '../../../src/core/ports/storage.js';
import type { ICodeMetaStore } from '../../../src/core/ports/code-meta.js';
import { CODE_TEST_IDS } from '../shared/test-constants.js';

export interface McpCodeFixture {
  client: Client;
  graph: FakeCodeGraph;
  vec: FakeCodeVectorStore;
  meta: FakeCodeMetaStore;
  embedding: FakeCodeEmbedding;
  parser: FakeCodeParser;
  workspaceStore: FakeWorkspaceStore;
  workspaceDir: string;
  /** Slug shared by `workspaces.id` and `code_projects.id` (ARG-264 invariant). */
  workspaceId: string;
  teardown: () => Promise<void>;
}

export async function setupMcpCodeFixture(): Promise<McpCodeFixture> {
  const workspaceId = CODE_TEST_IDS.projectA;
  const workspaceDir = mkdtempSync(join(tmpdir(), 'argustack-mcp-code-'));
  mkdirSync(join(workspaceDir, '.argustack'), { recursive: true });
  process.env['ARGUSTACK_WORKSPACE_ID'] = workspaceId;

  const graph = new FakeCodeGraph();
  const vec = new FakeCodeVectorStore();
  const meta = new FakeCodeMetaStore();
  const embedding = new FakeCodeEmbedding(16);
  const parser = new FakeCodeParser();
  const workspaceStore = new FakeWorkspaceStore();
  await workspaceStore.create({
    id: workspaceId,
    name: workspaceId,
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
    settings: {},
  });
  setActiveWorkspaceStore(workspaceStore);

  const storageStub = meta as unknown as IStorage & ICodeMetaStore;

  const adapters: CodeAdapters = {
    graph,
    vec,
    parser,
    embedding,
    meta,
    storage: storageStub,
    chatLlm: null,
  };
  setActiveCodeAdapters(adapters);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const { server } = await import('../../../src/mcp/server.js');
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await server.server.connect(serverTransport);
  await client.connect(clientTransport);

  const teardown = async (): Promise<void> => {
    setActiveCodeAdapters(null);
    Reflect.deleteProperty(process.env, 'ARGUSTACK_WORKSPACE_ID');
    await clientTransport.close();
    await serverTransport.close();
    rmSync(workspaceDir, { recursive: true, force: true });
  };

  return { client, graph, vec, meta, embedding, parser, workspaceStore, workspaceDir, workspaceId, teardown };
}
