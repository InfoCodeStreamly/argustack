import { describe, it, expect, beforeEach, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  class EventEmitter {
    private readonly handlers = new Map<string, ((...args: unknown[]) => void)[]>();
    on(event: string, fn: (...args: unknown[]) => void): this {
      const list = this.handlers.get(event) ?? [];
      list.push(fn);
      this.handlers.set(event, list);
      return this;
    }
    emit(event: string, ...args: unknown[]): void {
      for (const fn of this.handlers.get(event) ?? []) {
        fn(...args);
      }
    }
  }
  const sendRequest = vi.fn();
  const sendNotification = vi.fn().mockResolvedValue(undefined);
  const listen = vi.fn();
  const dispose = vi.fn();
  const stderr = new EventEmitter();
  const child = {
    stdin: { write: vi.fn() },
    stdout: new EventEmitter(),
    stderr,
    on: vi.fn(),
    kill: vi.fn(),
  };
  const spawn = vi.fn(() => child);
  return { spawn, sendRequest, sendNotification, listen, dispose, child };
});
const mockSpawn = hoisted.spawn;
const mockSendRequest = hoisted.sendRequest;
const mockSendNotification = hoisted.sendNotification;
const mockListen = hoisted.listen;
const mockDispose = hoisted.dispose;
const mockChild = hoisted.child;

vi.mock('node:child_process', () => ({
  spawn: hoisted.spawn,
}));

vi.mock('vscode-jsonrpc/node.js', () => ({
  createMessageConnection: vi.fn(() => ({
    sendRequest: hoisted.sendRequest,
    sendNotification: hoisted.sendNotification,
    listen: hoisted.listen,
    dispose: hoisted.dispose,
  })),
  StreamMessageReader: vi.fn(),
  StreamMessageWriter: vi.fn(),
}));

import { TypeScriptLspClient } from '../../../../src/adapters/lsp/index.js';

beforeEach(() => {
  mockSpawn.mockClear();
  mockSendRequest.mockReset();
  mockSendRequest.mockResolvedValue(null);
  mockSendNotification.mockReset();
  mockSendNotification.mockResolvedValue(undefined);
  mockListen.mockClear();
  mockDispose.mockClear();
});

describe('TypeScriptLspClient', () => {
  it('start spawns typescript-language-server and sends initialize + initialized', async () => {
    const client = new TypeScriptLspClient();
    await client.start('/proj/root');

    expect(mockSpawn).toHaveBeenCalledWith('typescript-language-server', ['--stdio'], { cwd: '/proj/root' });
    expect(mockListen).toHaveBeenCalled();

    const initCall = mockSendRequest.mock.calls.find((c) => c[0] === 'initialize');
    expect(initCall).toBeDefined();
    const params = initCall?.[1] as { rootUri: string };
    expect(params.rootUri).toContain('file:///proj/root');

    expect(mockSendNotification).toHaveBeenCalledWith('initialized', expect.anything());
  });

  it('respects custom command + args', async () => {
    const client = new TypeScriptLspClient({ command: 'my-lsp', args: ['--mode=quick'] });
    await client.start('/r');

    expect(mockSpawn).toHaveBeenCalledWith('my-lsp', ['--mode=quick'], { cwd: '/r' });
  });

  it('didOpen forwards textDocument', async () => {
    const client = new TypeScriptLspClient();
    await client.start('/r');
    await client.didOpen('file:///r/a.ts', 'export const x = 1;');

    const call = mockSendNotification.mock.calls.find((c) => c[0] === 'textDocument/didOpen');
    expect(call).toBeDefined();
    const params = call?.[1] as { textDocument: { uri: string; text: string; languageId: string } };
    expect(params.textDocument.uri).toBe('file:///r/a.ts');
    expect(params.textDocument.text).toBe('export const x = 1;');
    expect(params.textDocument.languageId).toBe('typescript');
  });

  it('documentSymbols flattens nested children', async () => {
    mockSendRequest
      .mockResolvedValueOnce({}) // initialize
      .mockResolvedValueOnce([
        {
          name: 'Calc',
          kind: 5,
          range: { start: { line: 0, character: 0 }, end: { line: 5, character: 0 } },
          children: [
            {
              name: 'add',
              kind: 12,
              range: { start: { line: 1, character: 2 }, end: { line: 1, character: 30 } },
            },
          ],
        },
      ]);

    const client = new TypeScriptLspClient();
    await client.start('/r');
    const syms = await client.documentSymbols('file:///r/Calc.ts');

    expect(syms).toHaveLength(2);
    expect(syms.map((s) => s.name)).toEqual(['Calc', 'add']);
    expect(syms[1]?.containerName).toBe('Calc');
  });

  it('references returns mapped locations', async () => {
    mockSendRequest
      .mockResolvedValueOnce({}) // initialize
      .mockResolvedValueOnce([
        {
          uri: 'file:///r/B.ts',
          range: { start: { line: 10, character: 4 }, end: { line: 10, character: 20 } },
        },
      ]);

    const client = new TypeScriptLspClient();
    await client.start('/r');
    const refs = await client.references('file:///r/A.ts', 0, 5);

    expect(refs).toEqual([
      { uri: 'file:///r/B.ts', startLine: 10, startChar: 4, endLine: 10, endChar: 20 },
    ]);
  });

  it('definition handles single Location (not array) response', async () => {
    mockSendRequest
      .mockResolvedValueOnce({}) // initialize
      .mockResolvedValueOnce({
        uri: 'file:///r/X.ts',
        range: { start: { line: 1, character: 0 }, end: { line: 1, character: 5 } },
      });

    const client = new TypeScriptLspClient();
    await client.start('/r');
    const defs = await client.definition('file:///r/A.ts', 0, 0);

    expect(defs).toHaveLength(1);
    expect(defs[0]?.uri).toBe('file:///r/X.ts');
  });

  it('stop sends shutdown + exit and kills process', async () => {
    const client = new TypeScriptLspClient();
    await client.start('/r');
    await client.stop();

    const shutdownCall = mockSendRequest.mock.calls.find((c) => c[0] === 'shutdown');
    expect(shutdownCall).toBeDefined();
    expect(mockSendNotification).toHaveBeenCalledWith('exit');
    expect(mockChild.kill).toHaveBeenCalled();
  });

  it('throws when methods called before start()', async () => {
    const client = new TypeScriptLspClient();
    await expect(client.documentSymbols('file:///x.ts')).rejects.toThrow(/LSP client not started/);
  });
});
