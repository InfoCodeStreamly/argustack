import type { CodeLanguage, ParsedFile } from '../types/code.js';

/**
 * Port: Code Parser — extracts symbols, imports and raw call sites from source.
 *
 * Backed by tree-sitter in production. Pure CPU; no I/O beyond input string.
 * Cross-file resolution (qualifying call site identifiers) is done by
 * `ISymbolResolver` in the indexer, not here.
 */
export interface ICodeParser {
  readonly languages: readonly CodeLanguage[];

  parseFile(
    absPath: string,
    content: string,
    language: CodeLanguage,
  ): Promise<ParsedFile>;
}
