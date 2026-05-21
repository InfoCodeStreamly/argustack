import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupMcpCodeFixture, type McpCodeFixture } from '../fixtures/builders/mcp-code-fixture.js';
import {
  createCodeProject,
  createCodeSymbol,
  createCodeFile,
  createCallEdge,
  CODE_TEST_IDS,
} from '../fixtures/shared/test-constants.js';

interface ToolTextResult {
  content: { type: string; text: string }[];
  isError?: boolean;
}

describe('MCP code-graph tools', () => {
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
    const project = createCodeProject({ root: fix.workspaceDir });
    await fix.meta.registerProject(project);
    await fix.graph.ensureProject(project);
  });

  it('lists all code-graph tools', async () => {
    const { tools } = await fix.client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain('find_symbol');
    expect(names).toContain('get_dependencies');
    expect(names).toContain('get_dependents');
    expect(names).toContain('get_callers');
    expect(names).toContain('get_callees');
    expect(names).toContain('get_call_path');
    expect(names).toContain('find_arch_violations');
    expect(names).toContain('find_unused_exports');
    expect(names).toContain('get_implementers');
    expect(names).toContain('get_layer_symbols');
  });

  it('find_symbol returns matching symbols', async () => {
    fix.graph.seed({
      symbols: [
        createCodeSymbol({ qualifiedName: 'InvoiceService', name: 'InvoiceService', kind: 'class' }),
        createCodeSymbol({ qualifiedName: 'UserService', name: 'UserService', kind: 'class' }),
      ],
    });

    const result = (await fix.client.callTool({
      name: 'find_symbol',
      arguments: { query: 'Invoice', workspace_id: fix.workspaceId },
    })) as ToolTextResult;

    expect(result.isError).toBeFalsy();
    expect(result.content[0]?.text).toContain('InvoiceService');
    expect(result.content[0]?.text).not.toContain('UserService');
  });

  it('find_symbol returns "no symbols" when nothing matches', async () => {
    const result = (await fix.client.callTool({
      name: 'find_symbol',
      arguments: { query: 'Nonexistent', workspace_id: fix.workspaceId },
    })) as ToolTextResult;

    expect(result.content[0]?.text.toLowerCase()).toContain('no symbols');
  });

  it('get_layer_symbols filters by layer', async () => {
    fix.graph.seed({
      symbols: [
        createCodeSymbol({ qualifiedName: 'domainQn', name: 'DomainThing', layer: 'domain' }),
        createCodeSymbol({ qualifiedName: 'appQn', name: 'AppThing', layer: 'application' }),
      ],
    });

    const result = (await fix.client.callTool({
      name: 'get_layer_symbols',
      arguments: { layer: 'domain', workspace_id: fix.workspaceId },
    })) as ToolTextResult;

    expect(result.content[0]?.text).toContain('domainQn');
    expect(result.content[0]?.text).not.toContain('appQn');
  });

  it('get_callers returns transitively-found symbols', async () => {
    const a = createCodeSymbol({ qualifiedName: 'A', name: 'A' });
    const b = createCodeSymbol({ qualifiedName: 'B', name: 'B' });
    fix.graph.seed({
      symbols: [a, b],
      calls: [createCallEdge({ fromQn: 'A', toQn: 'B' })],
    });

    const result = (await fix.client.callTool({
      name: 'get_callers',
      arguments: { qualified_name: 'B', workspace_id: fix.workspaceId },
    })) as ToolTextResult;

    expect(result.content[0]?.text).toContain('A');
  });

  it('get_dependencies returns imported files', async () => {
    const fileA = createCodeFile({ path: 'src/A.ts' });
    const fileB = createCodeFile({ path: 'src/B.ts' });
    fix.graph.seed({
      files: [fileA, fileB],
      imports: [
        { projectId: CODE_TEST_IDS.projectA, fromFile: 'src/A.ts', toFile: 'src/B.ts', names: ['B'] },
      ],
    });

    const result = (await fix.client.callTool({
      name: 'get_dependencies',
      arguments: { file: 'src/A.ts', workspace_id: fix.workspaceId },
    })) as ToolTextResult;

    expect(result.content[0]?.text).toContain('B.ts');
  });

  it('find_arch_violations returns violations or empty result', async () => {
    const result = (await fix.client.callTool({
      name: 'find_arch_violations',
      arguments: { workspace_id: fix.workspaceId },
    })) as ToolTextResult;

    expect(result.content[0]?.text).toBeTruthy();
  });

  it('errors when workspace has no registered code project', async () => {
    fix.meta.clear();
    const result = (await fix.client.callTool({
      name: 'find_symbol',
      arguments: { query: 'X', workspace_id: fix.workspaceId },
    })) as ToolTextResult;

    expect(result.content[0]?.text).toMatch(/not registered|Project/);
  });
});
