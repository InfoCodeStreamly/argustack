import { describe, it, expect } from 'vitest';
import { nodeToCodeFile, nodeToCodeSymbol } from '../../../../src/adapters/neo4j/mapper.js';
import type { Node } from 'neo4j-driver';

function mkNode(props: Record<string, unknown>): Node {
  return { properties: props } as unknown as Node;
}

describe('neo4j/mapper', () => {
  it('nodeToCodeFile maps required fields', () => {
    const file = nodeToCodeFile(mkNode({
      projectId: 'p1',
      path: 'src/a.ts',
      language: 'typescript',
      layer: 'domain',
      hash: 'abc',
    }));
    expect(file.path).toBe('src/a.ts');
    expect(file.language).toBe('typescript');
    expect(file.layer).toBe('domain');
  });

  it('nodeToCodeSymbol maps with number conversion', () => {
    const sym = nodeToCodeSymbol(mkNode({
      projectId: 'p1',
      qualifiedName: 'A.b',
      name: 'b',
      kind: 'method',
      filePath: 'a.ts',
      startLine: 1,
      endLine: 5,
    }));
    expect(sym.qualifiedName).toBe('A.b');
    expect(sym.kind).toBe('method');
    expect(sym.startLine).toBe(1);
  });
});
