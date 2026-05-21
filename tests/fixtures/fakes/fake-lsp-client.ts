import type { ILspClient } from '../../../src/core/ports/lsp-client.js';
import type { LspSymbol, LspLocation } from '../../../src/core/types/code.js';

export class FakeLspClient implements ILspClient {
  private started = false;
  private definitionDelayMs = 0;
  private readonly symbols = new Map<string, LspSymbol[]>();
  private readonly references = new Map<string, LspLocation[]>();
  private readonly definitions = new Map<string, LspLocation[]>();
  private readonly implementations = new Map<string, LspLocation[]>();
  private readonly typeDefinitions = new Map<string, LspLocation[]>();

  readonly didOpenCalls: { uri: string }[] = [];
  readonly didChangeCalls: { uri: string }[] = [];

  setDefinitionDelay(ms: number): void {
    this.definitionDelayMs = ms;
  }

  start(_projectRoot: string): Promise<void> {
    this.started = true;
    return Promise.resolve();
  }

  stop(): Promise<void> {
    this.started = false;
    return Promise.resolve();
  }

  didOpen(uri: string, _text: string): Promise<void> {
    this.didOpenCalls.push({ uri });
    return Promise.resolve();
  }

  didChange(uri: string, _text: string): Promise<void> {
    this.didChangeCalls.push({ uri });
    return Promise.resolve();
  }

  documentSymbols(uri: string): Promise<LspSymbol[]> {
    this.ensureStarted();
    return Promise.resolve(this.symbols.get(uri) ?? []);
  }

  references(
    uri: string,
    line: number,
    character: number,
  ): Promise<LspLocation[]> {
    this.ensureStarted();
    return Promise.resolve(this.references.get(key(uri, line, character)) ?? []);
  }

  definition(
    uri: string,
    line: number,
    character: number,
  ): Promise<LspLocation[]> {
    this.ensureStarted();
    const locs = this.definitions.get(key(uri, line, character)) ?? [];
    if (this.definitionDelayMs > 0) {
      return new Promise((resolve) => {
        setTimeout(() => { resolve(locs); }, this.definitionDelayMs);
      });
    }
    return Promise.resolve(locs);
  }

  implementations(
    uri: string,
    line: number,
    character: number,
  ): Promise<LspLocation[]> {
    this.ensureStarted();
    return Promise.resolve(
      this.implementations.get(key(uri, line, character)) ?? [],
    );
  }

  typeDefinition(
    uri: string,
    line: number,
    character: number,
  ): Promise<LspLocation[]> {
    this.ensureStarted();
    return Promise.resolve(
      this.typeDefinitions.get(key(uri, line, character)) ?? [],
    );
  }

  setSymbols(uri: string, syms: LspSymbol[]): void {
    this.symbols.set(uri, syms);
  }

  setReferences(uri: string, line: number, character: number, locs: LspLocation[]): void {
    this.references.set(key(uri, line, character), locs);
  }

  setDefinition(uri: string, line: number, character: number, locs: LspLocation[]): void {
    this.definitions.set(key(uri, line, character), locs);
  }

  clear(): void {
    this.symbols.clear();
    this.references.clear();
    this.definitions.clear();
    this.implementations.clear();
    this.typeDefinitions.clear();
    this.didOpenCalls.length = 0;
    this.didChangeCalls.length = 0;
  }

  private ensureStarted(): void {
    if (!this.started) {
      throw new Error('FakeLspClient: start() not called');
    }
  }
}

function key(uri: string, line: number, character: number): string {
  return `${uri}:${String(line)}:${String(character)}`;
}
