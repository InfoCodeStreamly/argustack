import type { LspSymbol, LspLocation } from '../types/code.js';

/**
 * Port: Language Server Protocol client — cross-file symbol resolution.
 *
 * Backed by `typescript-language-server` spawned as a subprocess.
 * Used by `SymbolResolver` in code-intel/ to upgrade tree-sitter raw call sites
 * (callee identifier text) into qualified-name edges.
 *
 * @throws Error when the LSP subprocess crashes irrecoverably.
 */
export interface ILspClient {
  start(projectRoot: string): Promise<void>;

  didOpen(uri: string, text: string): Promise<void>;

  didChange(uri: string, text: string): Promise<void>;

  documentSymbols(uri: string): Promise<LspSymbol[]>;

  references(
    uri: string,
    line: number,
    character: number,
  ): Promise<LspLocation[]>;

  definition(
    uri: string,
    line: number,
    character: number,
  ): Promise<LspLocation[]>;

  implementations(
    uri: string,
    line: number,
    character: number,
  ): Promise<LspLocation[]>;

  typeDefinition(
    uri: string,
    line: number,
    character: number,
  ): Promise<LspLocation[]>;

  stop(): Promise<void>;
}
