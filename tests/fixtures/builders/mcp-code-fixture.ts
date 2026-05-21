import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { setActiveCodeAdapters, type CodeAdapters } from '../../../src/mcp/helpers.js';
import { FakeCodeGraph } from '../fakes/fake-code-graph.js';
import { FakeCodeVectorStore } from '../fakes/fake-code-vector-store.js';
import { FakeCodeMetaStore } from '../fakes/fake-code-meta-store.js';
import { FakeCodeEmbedding } from '../fakes/fake-code-embedding.js';
import { FakeCodeParser } from '../fakes/fake-code-parser.js';
import type { IStorage } from '../../../src/core/ports/storage.js';
import type { ICodeMetaStore } from '../../../src/core/ports/code-meta.js';

export interface McpCodeFixture {
  client: Client;
  graph: FakeCodeGraph;
  vec: FakeCodeVectorStore;
  meta: FakeCodeMetaStore;
  embedding: FakeCodeEmbedding;
  parser: FakeCodeParser;
  workspaceDir: string;
  teardown: () => Promise<void>;
}

export async function setupMcpCodeFixture(): Promise<McpCodeFixture> {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'argustack-mcp-code-'));
  mkdirSync(join(workspaceDir, '.argustack'), { recursive: true });
  writeFileSync(
    join(workspaceDir, '.argustack', 'config.json'),
    JSON.stringify({ name: 'fixture', version: 1, sources: { code: { enabled: true } } }, null, 2),
  );
  writeFileSync(join(workspaceDir, '.env'), '');
  process.env['ARGUSTACK_WORKSPACE'] = workspaceDir;

  const graph = new FakeCodeGraph();
  const vec = new FakeCodeVectorStore();
  const meta = new FakeCodeMetaStore();
  const embedding = new FakeCodeEmbedding(16);
  const parser = new FakeCodeParser();

  const storageStub = meta as unknown as IStorage & ICodeMetaStore;

  const adapters: CodeAdapters = {
    graph,
    vec,
    parser,
    embedding,
    meta,
    storage: storageStub,
  };
  setActiveCodeAdapters(adapters);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const { server } = await import('../../../src/mcp/server.js');
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await server.server.connect(serverTransport);
  await client.connect(clientTransport);

  const teardown = async (): Promise<void> => {
    setActiveCodeAdapters(null);
    Reflect.deleteProperty(process.env, 'ARGUSTACK_WORKSPACE');
    await clientTransport.close();
    await serverTransport.close();
    rmSync(workspaceDir, { recursive: true, force: true });
  };

  return { client, graph, vec, meta, embedding, parser, workspaceDir, teardown };
}
