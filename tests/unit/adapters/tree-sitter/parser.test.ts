import { describe, it, expect, beforeAll } from 'vitest';
import { TreeSitterParser } from '../../../../src/adapters/tree-sitter/index.js';

const PROJECT_ROOT = '/proj';

describe('TreeSitterParser', () => {
  let parser: TreeSitterParser;

  beforeAll(() => {
    parser = new TreeSitterParser({ projectRoot: PROJECT_ROOT });
  });

  it('parses a function declaration', async () => {
    const parsed = await parser.parseFile('/proj/src/utils.ts', 'export function add(a: number, b: number) { return a + b; }', 'typescript');

    expect(parsed.symbols).toHaveLength(1);
    expect(parsed.symbols[0]).toMatchObject({
      name: 'add',
      kind: 'function',
      filePath: 'src/utils.ts',
    });
    expect(parsed.symbols[0]?.qualifiedName).toMatch(/utils\.add$/);
  });

  it('parses a class with methods', async () => {
    const source = `export class Calc {
  add(a: number, b: number) { return a + b; }
  sub(a: number, b: number) { return a - b; }
}`;
    const parsed = await parser.parseFile('/proj/src/Calc.ts', source, 'typescript');

    const kinds = parsed.symbols.map((s) => s.kind).sort();
    expect(kinds).toEqual(['class', 'method', 'method']);
    const names = parsed.symbols.map((s) => s.name).sort();
    expect(names).toEqual(['Calc', 'add', 'sub']);
  });

  it('parses an interface declaration', async () => {
    const parsed = await parser.parseFile(
      '/proj/src/IRepo.ts',
      'export interface IRepo { find(id: string): Promise<void>; }',
      'typescript',
    );
    expect(parsed.symbols).toHaveLength(1);
    expect(parsed.symbols[0]?.kind).toBe('interface');
    expect(parsed.symbols[0]?.name).toBe('IRepo');
  });

  it('parses a type alias', async () => {
    const parsed = await parser.parseFile(
      '/proj/src/types.ts',
      'export type Status = "open" | "closed";',
      'typescript',
    );
    expect(parsed.symbols).toHaveLength(1);
    expect(parsed.symbols[0]?.kind).toBe('type');
    expect(parsed.symbols[0]?.name).toBe('Status');
  });

  it('parses an enum', async () => {
    const parsed = await parser.parseFile(
      '/proj/src/Color.ts',
      'export enum Color { Red, Green }',
      'typescript',
    );
    expect(parsed.symbols).toHaveLength(1);
    expect(parsed.symbols[0]?.kind).toBe('enum');
    expect(parsed.symbols[0]?.name).toBe('Color');
  });

  it('extracts top-level const declarations', async () => {
    const parsed = await parser.parseFile(
      '/proj/src/config.ts',
      'export const VERSION = "1.0";\nexport const tags = ["a", "b"];',
      'typescript',
    );
    const consts = parsed.symbols.filter((s) => s.kind === 'const');
    expect(consts.map((s) => s.name).sort()).toEqual(['VERSION', 'tags']);
  });

  it('extracts relative imports', async () => {
    const parsed = await parser.parseFile(
      '/proj/src/index.ts',
      `import { foo } from './foo.js';\nimport { bar } from '../shared/bar.js';\nimport pkg from 'external-lib';`,
      'typescript',
    );
    expect(parsed.imports.map((i) => i.toFile)).toEqual(['./foo.js', '../shared/bar.js']);
  });

  it('records call sites inside function bodies', async () => {
    const source = `export function outer() {
  inner();
  obj.method();
}`;
    const parsed = await parser.parseFile('/proj/src/calls.ts', source, 'typescript');

    expect(parsed.rawCalls.length).toBeGreaterThanOrEqual(2);
    const calleeTexts = parsed.rawCalls.map((c) => c.calleeText);
    expect(calleeTexts).toContain('inner');
    expect(calleeTexts.some((c) => c.includes('method'))).toBe(true);
  });

  it('handles tsx with JSX', async () => {
    const parsed = await parser.parseFile(
      '/proj/src/Hello.tsx',
      'export const Hello = () => <div>hi</div>;',
      'tsx',
    );
    const names = parsed.symbols.map((s) => s.name);
    expect(names).toContain('Hello');
  });

  it('builds qualified names from relative path', async () => {
    const parsed = await parser.parseFile(
      '/proj/src/adapters/postgres/store.ts',
      'export class Store {}',
      'typescript',
    );
    expect(parsed.symbols[0]?.qualifiedName).toBe('src.adapters.postgres.store.Store');
  });
});
