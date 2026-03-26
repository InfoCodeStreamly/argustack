/**
 * Unit tests for startBoardServer and the HTTP request handlers it wires up.
 *
 * All heavy dependencies (SqlJsBoardStore, ClaudeSkillRunner, use-cases,
 * skill-discovery, node:http createServer) are replaced with fakes or vi.mock
 * stubs so no real server is spawned and no filesystem is touched.
 *
 * Strategy:
 *  - Capture the request handler passed to createServer.
 *  - Build lightweight IncomingMessage / ServerResponse stubs.
 *  - Exercise each route branch directly.
 */

import { describe, it, expect, vi, beforeAll, type Mock } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type http from 'node:http';
import type fs from 'node:fs';
import { FakeBoardStore } from '../../fixtures/fakes/fake-board-store.js';
import { FakeSkillRunner } from '../../fixtures/fakes/fake-skill-runner.js';

const fakeBoardStore = new FakeBoardStore();
const fakeSkillRunner = new FakeSkillRunner();

const mockSyncExecute = vi.fn().mockResolvedValue({
  tasks: [],
  pipeline: {
    columns: [
      { name: 'backlog', displayName: 'Backlog', type: 'system' },
      { name: 'done', displayName: 'Done', type: 'system' },
    ],
    port: 5002,
  },
});
const mockMoveExecute = vi.fn();

vi.mock('../../../src/adapters/board/store.js', () => ({
  SqlJsBoardStore: vi.fn(function SqlJsBoardStore() {
    return fakeBoardStore;
  }),
}));

vi.mock('../../../src/adapters/board/skill-runner.js', () => ({
  ClaudeSkillRunner: vi.fn(function ClaudeSkillRunner() {
    return fakeSkillRunner;
  }),
}));

vi.mock('../../../src/adapters/board/skill-discovery.js', () => ({
  discoverSkills: vi.fn().mockReturnValue([
    { name: 'code-review', description: 'Reviews code', source: 'project', path: '/p/.claude/skills/code-review' },
  ]),
}));

vi.mock('../../../src/use-cases/sync-board.js', () => ({
  SyncBoardUseCase: vi.fn(function SyncBoardUseCase() {
    return { execute: mockSyncExecute };
  }),
}));

vi.mock('../../../src/use-cases/move-task.js', () => ({
  MoveTaskUseCase: vi.fn(function MoveTaskUseCase() {
    return { execute: mockMoveExecute };
  }),
}));

vi.mock('node:http', async (importOriginal) => {
  const mod = await importOriginal<typeof http>();
  return { ...mod, createServer: vi.fn() };
});

vi.mock('node:fs', async (importOriginal) => {
  const mod = await importOriginal<typeof fs>();
  return {
    ...mod,
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn().mockReturnValue(Buffer.from('<html></html>')),
  };
});

const WORKSPACE_ROOT = '/test/workspace';
const DEFAULT_PORT = 5002;

type RequestHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

let capturedHandler: RequestHandler;
let mockServerListen: Mock;

function buildResMock() {
  const written: string[] = [];
  let resolveEnd: () => void;
  const endPromise = new Promise<void>((r) => { resolveEnd = r; });
  return {
    writeHead: vi.fn(),
    write: vi.fn((chunk: string) => { written.push(chunk); }),
    end: vi.fn((chunk?: string) => {
      if (chunk) { written.push(chunk); }
      resolveEnd();
    }),
    _written: written,
    _waitForEnd: () => endPromise,
  };
}

function buildReqMock(method: string, pathname: string, body?: string) {
  let dataCallback: ((c: string) => void) | null = null;
  let endCallback: (() => void) | null = null;

  const req = {
    url: pathname,
    method,
    setEncoding: vi.fn(),
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (event === 'data') { dataCallback = cb as (c: string) => void; }
      if (event === 'end') { endCallback = cb as () => void; }
      return req;
    }),
    _emit: () => {
      if (body && dataCallback) { dataCallback(body); }
      if (endCallback) { endCallback(); }
    },
  } as unknown as IncomingMessage & { _emit: () => void };

  return req;
}

beforeAll(async () => {
  const http = await import('node:http');
  mockServerListen = vi.fn((_port: number, cb: () => void) => { cb(); return {}; });
  vi.mocked(http.createServer).mockImplementation((handler) => {
    capturedHandler = handler as RequestHandler;
    return { listen: mockServerListen, close: vi.fn() } as never;
  });

  const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { /* suppress */ });
  const { startBoardServer } = await import('../../../src/cli/board-server.js');
  await startBoardServer(WORKSPACE_ROOT, DEFAULT_PORT);
  consoleSpy.mockRestore();
});

describe('startBoardServer', () => {
  describe('GET /api/board', () => {
    it('responds with JSON containing tasks, pipeline, skills, and claudeAvailable', async () => {
      const req = buildReqMock('GET', '/api/board');
      const res = buildResMock();

      await capturedHandler(req, res as never);

      expect(res.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });
      expect(res.end).toHaveBeenCalled();
      const body = JSON.parse(res.end.mock.calls[0]?.[0] ?? '') as {
        tasks: unknown[];
        pipeline: unknown;
        skills: unknown[];
        claudeAvailable: boolean;
      };
      expect(Array.isArray(body.tasks)).toBe(true);
      expect(body.pipeline).toBeDefined();
      expect(Array.isArray(body.skills)).toBe(true);
      expect(typeof body.claudeAvailable).toBe('boolean');
    });

    it('includes the discovered skill in the skills array', async () => {
      const req = buildReqMock('GET', '/api/board');
      const res = buildResMock();

      await capturedHandler(req, res as never);

      const body = JSON.parse(res.end.mock.calls[0]?.[0] ?? '') as {
        skills: { name: string; description: string; source: string }[];
      };
      expect(body.skills[0]).toMatchObject({
        name: 'code-review',
        description: 'Reviews code',
        source: 'project',
      });
    });
  });

  describe('POST /api/tasks/move', () => {
    it('responds with SSE done event when move succeeds', async () => {
      mockMoveExecute.mockResolvedValueOnce({
        task: { id: 'task-1', title: 'My task' },
        skillTriggered: false,
      });

      const body = JSON.stringify({ taskId: 'task-1', targetColumn: 'done' });
      const req = buildReqMock('POST', '/api/tasks/move', body);
      const res = buildResMock();

      void capturedHandler(req, res as never);
      req._emit();
      await res._waitForEnd();

      expect(res.writeHead).toHaveBeenCalledWith(
        200,
        expect.objectContaining({ 'Content-Type': 'text/event-stream' }),
      );
      const allChunks = res._written.join('');
      expect(allChunks).toContain('"type":"done"');
    });

    it('sends SSE error event when move throws', async () => {
      mockMoveExecute.mockRejectedValueOnce(new Error('transition not allowed'));

      const body = JSON.stringify({ taskId: 'task-1', targetColumn: 'unknown' });
      const req = buildReqMock('POST', '/api/tasks/move', body);
      const res = buildResMock();

      void capturedHandler(req, res as never);
      req._emit();
      await res._waitForEnd();

      const allChunks = res._written.join('');
      expect(allChunks).toContain('"type":"error"');
      expect(allChunks).toContain('transition not allowed');
    });

    it('sets SSE response headers before streaming', async () => {
      mockMoveExecute.mockResolvedValueOnce({ task: {}, skillTriggered: false });

      const body = JSON.stringify({ taskId: 'task-2', targetColumn: 'done' });
      const req = buildReqMock('POST', '/api/tasks/move', body);
      const res = buildResMock();

      void capturedHandler(req, res as never);
      req._emit();
      await res._waitForEnd();

      expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
        Connection: 'keep-alive',
        'Cache-Control': 'no-cache',
      }));
    });
  });

  describe('PUT /api/pipeline', () => {
    it('persists the pipeline config and responds with ok:true', async () => {
      const pipelinePayload = JSON.stringify({
        columns: [
          { name: 'backlog', displayName: 'Backlog', type: 'system' },
          { name: 'done', displayName: 'Done', type: 'system' },
        ],
        port: DEFAULT_PORT,
      });
      const req = buildReqMock('PUT', '/api/pipeline', pipelinePayload);
      const res = buildResMock();

      void capturedHandler(req, res as never);
      req._emit();
      await res._waitForEnd();

      expect(res.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });
      const responseBody = JSON.parse(res.end.mock.calls[0]?.[0] ?? '') as { ok: boolean };
      expect(responseBody.ok).toBe(true);
    });
  });

  describe('SPA fallback', () => {
    it('returns 404 with a hint when the board UI has not been built', async () => {
      const fsModule = await import('node:fs');
      vi.mocked(fsModule.existsSync).mockReturnValue(false);

      const req = buildReqMock('GET', '/');
      const res = buildResMock();

      await capturedHandler(req, res as never);

      expect(res.writeHead).toHaveBeenCalledWith(404);
      const responseText = res.end.mock.calls[0]?.[0] ?? '';
      expect(responseText).toContain('Board UI not built');
    });

    it('serves a static file with correct MIME type when it exists', async () => {
      const fsModule = await import('node:fs');
      vi.mocked(fsModule.existsSync).mockReturnValue(true);
      vi.mocked(fsModule.readFileSync).mockReturnValue(Buffer.from('<html></html>'));

      const req = buildReqMock('GET', '/');
      const res = buildResMock();

      await capturedHandler(req, res as never);

      expect(res.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'text/html' });
    });

    it('serves index.html for unknown paths when file does not directly exist', async () => {
      const fsModule = await import('node:fs');
      vi.mocked(fsModule.existsSync)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(true);
      vi.mocked(fsModule.readFileSync).mockReturnValue(Buffer.from('<html></html>'));

      const req = buildReqMock('GET', '/some/unknown/path');
      const res = buildResMock();

      await capturedHandler(req, res as never);

      expect(res.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'text/html' });
    });
  });

  describe('server startup', () => {
    it('starts listening on the requested port', () => {
      expect(mockServerListen).toHaveBeenCalledWith(DEFAULT_PORT, expect.any(Function));
    });
  });
});
