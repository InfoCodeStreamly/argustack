import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupMcpCodeFixture, type McpCodeFixture } from '../fixtures/builders/mcp-code-fixture.js';
import {
  createCodeProject,
  createCodeChunk,
  CODE_TEST_IDS,
} from '../fixtures/shared/test-constants.js';

interface ToolTextResult {
  content: { type: string; text: string }[];
  isError?: boolean;
}

describe('MCP code-search tools', () => {
  let fix: McpCodeFixture;

  beforeAll(async () => {
    fix = await setupMcpCodeFixture();
  });

  afterAll(async () => {
    await fix.teardown();
  });

  beforeEach(async () => {
    fix.graph.clear();
    fix.meta.clear();
    fix.vec.clear();
    const project = createCodeProject({ root: fix.workspaceDir });
    await fix.meta.registerProject(project);
    await fix.graph.ensureProject(project);
    await fix.vec.ensureCollection(CODE_TEST_IDS.projectA, fix.embedding.dimensions);
  });

  it('lists code-search tools', async () => {
    const { tools } = await fix.client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain('search_semantic');
    expect(names).toContain('find_similar_code');
  });

  it('search_semantic returns matches', async () => {
    const chunk = createCodeChunk({
      symbolId: 'tax-calc',
      name: 'calculateTax',
      content: 'tax calculation invoice',
      filePath: 'src/domain/Tax.ts',
    });
    const vec = await fix.embedding.embedCode([{ content: chunk.content, kind: chunk.kind }]);
    await fix.vec.upsertChunks(CODE_TEST_IDS.projectA, [chunk], vec);

    const result = (await fix.client.callTool({
      name: 'search_semantic',
      arguments: { query: 'tax calculation invoice', project_id: CODE_TEST_IDS.projectA, top_k: 5 },
    })) as ToolTextResult;

    expect(result.isError).toBeFalsy();
    expect(result.content[0]?.text).toContain('calculateTax');
  });

  it('search_semantic returns "no semantic matches" when collection is empty', async () => {
    const result = (await fix.client.callTool({
      name: 'search_semantic',
      arguments: { query: 'anything', project_id: CODE_TEST_IDS.projectA },
    })) as ToolTextResult;

    expect(result.content[0]?.text.toLowerCase()).toContain('no semantic matches');
  });

  it('search_semantic respects layer filter', async () => {
    const domainChunk = createCodeChunk({
      symbolId: 'd1',
      layer: 'domain',
      name: 'Invoice',
      content: 'invoice',
      filePath: 'src/domain/Invoice.ts',
    });
    const appChunk = createCodeChunk({
      symbolId: 'a1',
      layer: 'application',
      name: 'CreateInvoice',
      content: 'invoice',
      filePath: 'src/use-cases/CreateInvoice.ts',
    });
    const vecs = await fix.embedding.embedCode([
      { content: domainChunk.content, kind: domainChunk.kind },
      { content: appChunk.content, kind: appChunk.kind },
    ]);
    await fix.vec.upsertChunks(CODE_TEST_IDS.projectA, [domainChunk, appChunk], vecs);

    const result = (await fix.client.callTool({
      name: 'search_semantic',
      arguments: { query: 'invoice', layer: 'domain', project_id: CODE_TEST_IDS.projectA },
    })) as ToolTextResult;

    expect(result.content[0]?.text).toContain('Invoice');
    expect(result.content[0]?.text).not.toContain('CreateInvoice');
  });

  it('errors when project_id missing and CWD has no project', async () => {
    const result = (await fix.client.callTool({
      name: 'search_semantic',
      arguments: { query: 'anything' },
    })) as ToolTextResult;

    expect(result.content[0]?.text).toMatch(/Project not registered/);
  });
});
