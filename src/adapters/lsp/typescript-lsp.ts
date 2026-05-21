import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  createMessageConnection,
  type MessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from 'vscode-jsonrpc/node.js';
import type { ILspClient } from '../../core/ports/lsp-client.js';
import type { LspSymbol, LspLocation } from '../../core/types/code.js';

interface LspPosition {
  line: number;
  character: number;
}

interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

interface LspDocumentSymbol {
  name: string;
  kind: number;
  range: LspRange;
  children?: LspDocumentSymbol[];
}

interface LspLocationRaw {
  uri: string;
  range: LspRange;
}

export interface TypeScriptLspOptions {
  command?: string;
  args?: string[];
}

export class TypeScriptLspClient implements ILspClient {
  private process: ChildProcessWithoutNullStreams | null = null;
  private connection: MessageConnection | null = null;
  private readonly command: string;
  private readonly args: string[];

  constructor(options: TypeScriptLspOptions = {}) {
    this.command = options.command ?? 'typescript-language-server';
    this.args = options.args ?? ['--stdio'];
  }

  async start(projectRoot: string): Promise<void> {
    if (this.process) {return;}
    const child = spawn(this.command, this.args, { cwd: projectRoot });
    this.process = child;
    const reader = new StreamMessageReader(child.stdout);
    const writer = new StreamMessageWriter(child.stdin);
    const connection = createMessageConnection(reader, writer);
    this.connection = connection;
    connection.listen();
    child.stderr.on('data', () => { /* suppress LSP server logs */ });

    await connection.sendRequest<unknown>('initialize', {
      processId: process.pid,
      rootUri: pathToFileURL(projectRoot).toString(),
      capabilities: {},
      workspaceFolders: [
        { uri: pathToFileURL(projectRoot).toString(), name: 'workspace' },
      ],
    });
    await connection.sendNotification('initialized', {});
  }

  async stop(): Promise<void> {
    if (this.connection) {
      try {
        await this.connection.sendRequest('shutdown');
        await this.connection.sendNotification('exit');
      } catch { /* server may already be dead */ }
      this.connection.dispose();
      this.connection = null;
    }
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }

  async didOpen(uri: string, text: string): Promise<void> {
    const conn = this.requireConnection();
    await conn.sendNotification('textDocument/didOpen', {
      textDocument: { uri, languageId: 'typescript', version: 1, text },
    });
  }

  async didChange(uri: string, text: string): Promise<void> {
    const conn = this.requireConnection();
    await conn.sendNotification('textDocument/didChange', {
      textDocument: { uri, version: Date.now() },
      contentChanges: [{ text }],
    });
  }

  async documentSymbols(uri: string): Promise<LspSymbol[]> {
    const conn = this.requireConnection();
    const result = await conn.sendRequest<LspDocumentSymbol[] | null>(
      'textDocument/documentSymbol',
      { textDocument: { uri } },
    );
    return flattenSymbols(result ?? [], uri);
  }

  async references(uri: string, line: number, character: number): Promise<LspLocation[]> {
    const conn = this.requireConnection();
    const result = await conn.sendRequest<LspLocationRaw[] | null>(
      'textDocument/references',
      {
        textDocument: { uri },
        position: { line, character },
        context: { includeDeclaration: false },
      },
    );
    return (result ?? []).map(toLspLocation);
  }

  async definition(uri: string, line: number, character: number): Promise<LspLocation[]> {
    return this.locationRequest('textDocument/definition', uri, line, character);
  }

  async implementations(uri: string, line: number, character: number): Promise<LspLocation[]> {
    return this.locationRequest('textDocument/implementation', uri, line, character);
  }

  async typeDefinition(uri: string, line: number, character: number): Promise<LspLocation[]> {
    return this.locationRequest('textDocument/typeDefinition', uri, line, character);
  }

  private async locationRequest(
    method: string,
    uri: string,
    line: number,
    character: number,
  ): Promise<LspLocation[]> {
    const conn = this.requireConnection();
    const result = await conn.sendRequest<LspLocationRaw | LspLocationRaw[] | null>(
      method,
      { textDocument: { uri }, position: { line, character } },
    );
    if (!result) {return [];}
    const raw = Array.isArray(result) ? result : [result];
    return raw.map(toLspLocation);
  }

  private requireConnection(): MessageConnection {
    if (!this.connection) {
      throw new Error('LSP client not started — call start() first');
    }
    return this.connection;
  }
}

function toLspLocation(raw: LspLocationRaw): LspLocation {
  return {
    uri: raw.uri,
    startLine: raw.range.start.line,
    startChar: raw.range.start.character,
    endLine: raw.range.end.line,
    endChar: raw.range.end.character,
  };
}

function flattenSymbols(
  symbols: LspDocumentSymbol[],
  uri: string,
  container?: string,
): LspSymbol[] {
  const out: LspSymbol[] = [];
  for (const sym of symbols) {
    const lspSymbol: LspSymbol = {
      name: sym.name,
      kind: sym.kind,
      filePath: uri,
      startLine: sym.range.start.line + 1,
      endLine: sym.range.end.line + 1,
    };
    if (container) {
      lspSymbol.containerName = container;
    }
    out.push(lspSymbol);
    if (sym.children && sym.children.length > 0) {
      out.push(...flattenSymbols(sym.children, uri, sym.name));
    }
  }
  return out;
}
