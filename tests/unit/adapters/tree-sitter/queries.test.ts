import { describe, it, expect } from 'vitest';
import { SYMBOL_QUERIES } from '../../../../src/adapters/tree-sitter/queries.js';

describe('tree-sitter/queries', () => {
  it('exposes named queries for each symbol kind', () => {
    expect(SYMBOL_QUERIES.function).toContain('function_declaration');
    expect(SYMBOL_QUERIES.classDecl).toContain('class_declaration');
    expect(SYMBOL_QUERIES.method).toContain('method_definition');
    expect(SYMBOL_QUERIES.interfaceDecl).toContain('interface_declaration');
    expect(SYMBOL_QUERIES.typeAlias).toContain('type_alias_declaration');
    expect(SYMBOL_QUERIES.enumDecl).toContain('enum_declaration');
  });
});
