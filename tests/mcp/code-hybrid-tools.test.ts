import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupMcpCodeFixture, type McpCodeFixture } from '../fixtures/builders/mcp-code-fixture.js';
import {
  createCodeProject,
  createCodeChunk,
  createCodeSymbol,
  CODE_TEST_IDS,
} from '../fixtures/shared/test-constants.js';
import type { CodeChunk } from '../../src/core/types/code.js';

interface ToolTextResult {
  content: { type: string; text: string }[];
  isError?: boolean;
}

describe('MCP code-hybrid tools', () => {
  let fix: McpCodeFixture;

  beforeAll(async () => {
    fix = await setupMcpCodeFixture();
  });

  afterAll(async () => {
    await fix.teardown();
  });

  async function seedChunks(chunks: CodeChunk[]): Promise<void> {
    const vecs = await fix.embedding.embedCode(chunks.map((c) => ({ content: c.content, kind: c.kind })));
    await fix.vec.upsertChunks(CODE_TEST_IDS.projectA, chunks, vecs);
    for (const c of chunks) {
      fix.graph.seed({
        symbols: [
          createCodeSymbol({
            qualifiedName: c.symbolId,
            name: c.name,
            kind: c.kind,
            filePath: c.filePath,
            layer: c.layer,
          }),
        ],
      });
    }
  }

  beforeEach(async () => {
    fix.graph.clear();
    fix.vec.clear();
    fix.meta.clear();
    const project = createCodeProject({ root: fix.workspaceDir });
    await fix.meta.registerProject(project);
    await fix.graph.ensureProject(project);
    await fix.vec.ensureCollection(CODE_TEST_IDS.projectA, fix.embedding.dimensions);
  });

  it('lists code-hybrid tools', async () => {
    const { tools } = await fix.client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain('explain_feature');
    expect(names).toContain('plan_feature_files');
  });

  it('explain_feature returns layered summary', async () => {
    await seedChunks([
      createCodeChunk({ symbolId: 'd1', layer: 'domain', name: 'Auth', content: 'authentication session', filePath: 'src/domain/Auth.ts' }),
      createCodeChunk({ symbolId: 'a1', layer: 'application', name: 'LoginUseCase', content: 'login session', filePath: 'src/use-cases/Login.ts' }),
    ]);

    const result = (await fix.client.callTool({
      name: 'explain_feature',
      arguments: { query: 'authentication', project_id: CODE_TEST_IDS.projectA, top_k: 5 },
    })) as ToolTextResult;

    expect(result.isError).toBeFalsy();
    expect(result.content[0]?.text).toContain('Feature explanation');
  });

  it('plan_feature_files returns 4 layer sections', async () => {
    await seedChunks([
      createCodeChunk({ symbolId: 'd1', layer: 'domain', name: 'Invoice', content: 'invoice tax', filePath: 'src/domain/Invoice.ts' }),
      createCodeChunk({ symbolId: 'a1', layer: 'application', name: 'CreateInvoiceUseCase', content: 'tax invoice', filePath: 'src/use-cases/CreateInvoice.ts' }),
      createCodeChunk({ symbolId: 'i1', layer: 'infrastructure', name: 'InvoiceRepo', content: 'invoice postgres', filePath: 'src/adapters/postgres/InvoiceRepo.ts' }),
      createCodeChunk({ symbolId: 'p1', layer: 'presentation', name: 'invoiceRoute', content: 'invoice route', filePath: 'src/cli/invoice.ts' }),
    ]);

    const result = (await fix.client.callTool({
      name: 'plan_feature_files',
      arguments: { description: 'add tax calculation', project_id: CODE_TEST_IDS.projectA },
    })) as ToolTextResult;

    const text = result.content[0]?.text ?? '';
    expect(text).toContain('Domain');
    expect(text).toContain('Application');
    expect(text).toContain('Infrastructure');
    expect(text).toContain('Presentation');
  });

  it('errors when project_id missing and CWD has no project', async () => {
    const result = (await fix.client.callTool({
      name: 'plan_feature_files',
      arguments: { description: 'anything' },
    })) as ToolTextResult;

    expect(result.content[0]?.text).toMatch(/Project not registered/);
  });
});
