import { describe, it, expect } from 'vitest';
import { LspSymbolResolver } from '../../../src/code-intel/lsp-resolver.js';
import { FakeLspClient } from '../../fixtures/fakes/fake-lsp-client.js';
import { createCodeSymbol } from '../../fixtures/shared/test-constants.js';
import type { ParsedFile, CodeCallEdge } from '../../../src/core/types/code.js';

describe('LspSymbolResolver', () => {
  it('resolves call via LSP definition lookup to qualified-name edge', async () => {
    const projectRoot = '/project';
    const targetSymbol = createCodeSymbol({
      qualifiedName: 'src.lib.helpers.parseInvoice',
      name: 'parseInvoice',
      filePath: 'src/lib/helpers.ts',
      startLine: 10,
      endLine: 20,
    });
    const lsp = new FakeLspClient();
    await lsp.start(projectRoot);
    lsp.setDefinition('file:///project/src/main.ts', 5, 8, [
      { uri: 'file:///project/src/lib/helpers.ts', startLine: 9, startChar: 0, endLine: 19, endChar: 0 },
    ]);

    const resolver = new LspSymbolResolver(
      lsp,
      projectRoot,
      [targetSymbol],
      () => [],
    );

    const parsed: ParsedFile = {
      filePath: 'src/main.ts',
      language: 'typescript',
      symbols: [],
      imports: [],
      rawCalls: [
        { fromQn: 'src.main.run', calleeText: 'parseInvoice', line: 6, column: 8 },
      ],
    };

    const edges = await resolver.resolveCalls('proj-1', parsed);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      projectId: 'proj-1',
      fromQn: 'src.main.run',
      toQn: 'src.lib.helpers.parseInvoice',
      count: 1,
    });
  });

  it('falls back to heuristic resolver on LSP timeout', async () => {
    const lsp = new FakeLspClient();
    await lsp.start('/project');
    lsp.setDefinitionDelay(50);
    const fallbackEdge: CodeCallEdge = {
      projectId: 'proj-1',
      fromQn: 'A.use',
      toQn: 'B.target',
      count: 1,
    };

    const resolver = new LspSymbolResolver(
      lsp,
      '/project',
      [],
      () => [fallbackEdge],
      10,
    );

    const parsed: ParsedFile = {
      filePath: 'src/main.ts',
      language: 'typescript',
      symbols: [],
      imports: [],
      rawCalls: [{ fromQn: 'A.use', calleeText: 'target', line: 1, column: 0 }],
    };

    const edges = await resolver.resolveCalls('proj-1', parsed);
    expect(edges).toContainEqual(fallbackEdge);
  });

  it('returns empty when there are no calls', async () => {
    const resolver = new LspSymbolResolver(
      new FakeLspClient(),
      '/project',
      [],
      () => [],
    );
    const edges = await resolver.resolveCalls('proj-1', {
      filePath: 'src/main.ts',
      language: 'typescript',
      symbols: [],
      imports: [],
      rawCalls: [],
    });
    expect(edges).toEqual([]);
  });
});
