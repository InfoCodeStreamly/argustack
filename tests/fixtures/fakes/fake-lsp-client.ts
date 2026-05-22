import type { ILspClient } from '../../../src/core/ports/lsp-client.js';
import type { LspSymbol, LspLocation } from '../../../src/core/types/code.js';

export class FakeLspClient implements ILspClient {
  private started = false;
  private definitionDelayMs = 0;
  private readonly symbolsMap = new Map<string, LspSymbol[]>();
  private readonly referencesMap = new Map<string, LspLocation[]>();
  private readonly definitionsMap = new Map<string, LspLocation[]>();
  private readonly implementationsMap = new Map<string, LspLocation[]>();
  private readonly typeDefinitionsMap = new Map<string, LspLocation[]>();

  readonly didOpenCalls: { uri: string }[] = [];
  readonly didChangeCalls: { uri: string }[] = [];

  setDefinitionDelay(ms: number): void {
    this.definitionDelayMs = ms;
  }

  async start(_projectRoot: string): Promise<void> {
    this.started = true;
    return Promise.resolve();
  }

  async stop(): Promise<void> {
    this.started = false;
    return Promise.resolve();
  }

  async didOpen(uri: string, _text: string): Promise<void> {
    this.didOpenCalls.push({ uri });
    return Promise.resolve();
  }

  async didChange(uri: string, _text: string): Promise<void> {
    this.didChangeCalls.push({ uri });
    return Promise.resolve();
  }

  async documentSymbols(uri: string): Promise<LspSymbol[]> {
    this.ensureStarted();
    return Promise.resolve(this.symbolsMap.get(uri) ?? []);
  }

  async references(
    uri: string,
    line: number,
    character: number,
  ): Promise<LspLocation[]> {
    this.ensureStarted();
    return Promise.resolve(this.referencesMap.get(key(uri, line, character)) ?? []);
  }

  async definition(
    uri: string,
    line: number,
    character: number,
  ): Promise<LspLocation[]> {
    this.ensureStarted();
    const locs = this.definitionsMap.get(key(uri, line, character)) ?? [];
    if (this.definitionDelayMs > 0) {
      return new Promise((resolve) => {
        setTimeout(() => { resolve(locs); }, this.definitionDelayMs);
      });
    }
    return Promise.resolve(locs);
  }

  async implementations(
    uri: string,
    line: number,
    character: number,
  ): Promise<LspLocation[]> {
    this.ensureStarted();
    return Promise.resolve(
      this.implementationsMap.get(key(uri, line, character)) ?? [],
    );
  }

  async typeDefinition(
    uri: string,
    line: number,
    character: number,
  ): Promise<LspLocation[]> {
    this.ensureStarted();
    return Promise.resolve(
      this.typeDefinitionsMap.get(key(uri, line, character)) ?? [],
    );
  }

  setSymbols(uri: string, syms: LspSymbol[]): void {
    this.symbolsMap.set(uri, syms);
  }

  setReferences(uri: string, line: number, character: number, locs: LspLocation[]): void {
    this.referencesMap.set(key(uri, line, character), locs);
  }

  setDefinition(uri: string, line: number, character: number, locs: LspLocation[]): void {
    this.definitionsMap.set(key(uri, line, character), locs);
  }

  clear(): void {
    this.symbolsMap.clear();
    this.referencesMap.clear();
    this.definitionsMap.clear();
    this.implementationsMap.clear();
    this.typeDefinitionsMap.clear();
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
