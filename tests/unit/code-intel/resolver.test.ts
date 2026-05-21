import { describe, it, expect } from 'vitest';
import { SymbolResolver } from '../../../src/code-intel/resolver.js';
import { createCodeSymbol, CODE_TEST_IDS } from '../../fixtures/shared/test-constants.js';
import type { ParsedFile } from '../../../src/core/types/code.js';

describe('SymbolResolver', () => {
  it('resolves call to a symbol by name', () => {
    const symbols = [
      createCodeSymbol({ qualifiedName: 'src.A.fooBar', name: 'fooBar', filePath: 'src/A.ts' }),
    ];
    const resolver = new SymbolResolver(symbols);
    const parsed: ParsedFile = {
      filePath: 'src/B.ts',
      language: 'typescript',
      symbols: [],
      imports: [],
      rawCalls: [
        { fromQn: 'src.B.caller', calleeText: 'fooBar', line: 10, column: 4 },
      ],
    };

    const edges = resolver.resolveCalls(CODE_TEST_IDS.projectA, parsed);

    expect(edges).toEqual([
      {
        projectId: CODE_TEST_IDS.projectA,
        fromQn: 'src.B.caller',
        toQn: 'src.A.fooBar',
        count: 1,
      },
    ]);
  });

  it('prefers a same-file callee when multiple symbols share a name', () => {
    const symbols = [
      createCodeSymbol({ qualifiedName: 'src.A.helper', name: 'helper', filePath: 'src/A.ts' }),
      createCodeSymbol({ qualifiedName: 'src.B.helper', name: 'helper', filePath: 'src/B.ts' }),
    ];
    const resolver = new SymbolResolver(symbols);
    const parsed: ParsedFile = {
      filePath: 'src/B.ts',
      language: 'typescript',
      symbols: [],
      imports: [],
      rawCalls: [
        { fromQn: 'src.B.caller', calleeText: 'helper', line: 5, column: 2 },
      ],
    };

    const edges = resolver.resolveCalls(CODE_TEST_IDS.projectA, parsed);

    expect(edges).toHaveLength(1);
    expect(edges[0]?.toQn).toBe('src.B.helper');
  });

  it('extracts rightmost identifier from dotted access', () => {
    const symbols = [
      createCodeSymbol({ qualifiedName: 'src.A.create', name: 'create', filePath: 'src/A.ts' }),
    ];
    const resolver = new SymbolResolver(symbols);
    const parsed: ParsedFile = {
      filePath: 'src/B.ts',
      language: 'typescript',
      symbols: [],
      imports: [],
      rawCalls: [
        { fromQn: 'src.B.caller', calleeText: 'this.repo.create', line: 5, column: 2 },
      ],
    };

    const edges = resolver.resolveCalls(CODE_TEST_IDS.projectA, parsed);

    expect(edges[0]?.toQn).toBe('src.A.create');
  });

  it('aggregates repeated calls into one edge with count', () => {
    const symbols = [
      createCodeSymbol({ qualifiedName: 'src.A.fn', name: 'fn', filePath: 'src/A.ts' }),
    ];
    const resolver = new SymbolResolver(symbols);
    const parsed: ParsedFile = {
      filePath: 'src/B.ts',
      language: 'typescript',
      symbols: [],
      imports: [],
      rawCalls: [
        { fromQn: 'src.B.caller', calleeText: 'fn', line: 5, column: 0 },
        { fromQn: 'src.B.caller', calleeText: 'fn', line: 7, column: 0 },
        { fromQn: 'src.B.caller', calleeText: 'fn', line: 9, column: 0 },
      ],
    };

    const edges = resolver.resolveCalls(CODE_TEST_IDS.projectA, parsed);

    expect(edges).toHaveLength(1);
    expect(edges[0]?.count).toBe(3);
  });

  it('drops calls whose callee text is not a valid identifier', () => {
    const symbols = [
      createCodeSymbol({ qualifiedName: 'src.A.fn', name: 'fn', filePath: 'src/A.ts' }),
    ];
    const resolver = new SymbolResolver(symbols);
    const parsed: ParsedFile = {
      filePath: 'src/B.ts',
      language: 'typescript',
      symbols: [],
      imports: [],
      rawCalls: [
        { fromQn: 'src.B.caller', calleeText: '(x => x)', line: 5, column: 0 },
        { fromQn: 'src.B.caller', calleeText: 'fn', line: 6, column: 0 },
      ],
    };

    const edges = resolver.resolveCalls(CODE_TEST_IDS.projectA, parsed);

    expect(edges).toHaveLength(1);
    expect(edges[0]?.toQn).toBe('src.A.fn');
  });

  it('produces no edges when no symbols match', () => {
    const resolver = new SymbolResolver([]);
    const parsed: ParsedFile = {
      filePath: 'src/B.ts',
      language: 'typescript',
      symbols: [],
      imports: [],
      rawCalls: [
        { fromQn: 'src.B.caller', calleeText: 'unknown', line: 5, column: 0 },
      ],
    };

    expect(resolver.resolveCalls(CODE_TEST_IDS.projectA, parsed)).toEqual([]);
  });
});
