import { describe, it, expect } from 'vitest';
import { symbolsToChunks } from '../../../src/code-intel/chunker.js';
import { createCodeSymbol, CODE_TEST_IDS } from '../../fixtures/shared/test-constants.js';

describe('symbolsToChunks', () => {
  it('produces one chunk per symbol with content slice', () => {
    const source = ['line 1', 'line 2', 'export class Foo {}', 'line 4', 'line 5'].join('\n');
    const symbols = [
      createCodeSymbol({
        qualifiedName: 'src.Foo.Foo',
        name: 'Foo',
        startLine: 3,
        endLine: 3,
      }),
    ];

    const chunks = symbolsToChunks({
      projectId: CODE_TEST_IDS.projectA,
      filePath: 'src/Foo.ts',
      layer: 'domain',
      fileSource: source,
      symbols,
    });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.content).toBe('export class Foo {}');
    expect(chunks[0]?.symbolId).toBe('src.Foo.Foo');
    expect(chunks[0]?.layer).toBe('domain');
  });

  it('falls back to whole-file chunk when no symbols', () => {
    const source = 'export const x = 1;\nexport const y = 2;';
    const chunks = symbolsToChunks({
      projectId: CODE_TEST_IDS.projectA,
      filePath: 'src/config.ts',
      layer: null,
      fileSource: source,
      symbols: [],
    });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.content).toBe(source);
    expect(chunks[0]?.name).toBe('config.ts');
    expect(chunks[0]?.symbolId).toBe('src/config.ts::__file__');
  });

  it('produces multiple chunks for multiple symbols', () => {
    const source = [
      'export function foo() {}', // 1
      '',
      'export function bar() {}', // 3
      '',
      'export function baz() {}', // 5
    ].join('\n');
    const symbols = [
      createCodeSymbol({ qualifiedName: 'foo', name: 'foo', kind: 'function', startLine: 1, endLine: 1 }),
      createCodeSymbol({ qualifiedName: 'bar', name: 'bar', kind: 'function', startLine: 3, endLine: 3 }),
      createCodeSymbol({ qualifiedName: 'baz', name: 'baz', kind: 'function', startLine: 5, endLine: 5 }),
    ];

    const chunks = symbolsToChunks({
      projectId: CODE_TEST_IDS.projectA,
      filePath: 'src/funcs.ts',
      layer: 'application',
      fileSource: source,
      symbols,
    });

    expect(chunks).toHaveLength(3);
    expect(chunks.map((c) => c.name)).toEqual(['foo', 'bar', 'baz']);
  });
});
