import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Mock } from 'vitest';

const hoisted = vi.hoisted(() => {
  const spawn = vi.fn();
  const open = vi.fn();
  return { spawn, open };
});

vi.mock('node:child_process', () => ({
  spawn: hoisted.spawn,
}));

vi.mock('node:fs/promises', () => ({
  open: hoisted.open,
}));

import { HttpOllamaControl } from '../../../../src/adapters/ollama/index.js';
import { FakePlatformProbe } from '../../../fixtures/fakes/fake-platform-probe.js';
import type { CommandResult } from '../../../../src/core/ports/platform-probe.js';

type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const originalFetch = globalThis.fetch;
let fetchMock: Mock<FetchFn>;

function setCommand(probe: FakePlatformProbe, command: string, args: readonly string[], result: CommandResult): void {
  const key = `${command} ${args.join(' ')}`;
  probe.commandResults.set(key, result);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function getSpawnCall(index: number): [string, readonly string[], Record<string, unknown>] {
  const raw = hoisted.spawn.mock.calls[index] as unknown;
  if (!Array.isArray(raw)) {
    throw new Error(`spawn has no call at index ${String(index)}`);
  }
  const cmd = raw[0] as string;
  const args = raw[1] as readonly string[];
  const opts = (raw[2] ?? {}) as Record<string, unknown>;
  return [cmd, args, opts];
}

function ndjsonStreamResponse(lines: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(`${line}\n`));
      }
      controller.close();
    },
  });
  return new Response(stream, { status, headers: { 'Content-Type': 'application/x-ndjson' } });
}

beforeEach(() => {
  fetchMock = vi.fn<FetchFn>();
  globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  hoisted.spawn.mockReset();
  hoisted.open.mockReset();
  hoisted.spawn.mockReturnValue({ unref: vi.fn() });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('HttpOllamaControl', () => {
  describe('isInstalled', () => {
    it('returns true when ollama command is on PATH', async () => {
      const probe = new FakePlatformProbe();
      probe.availableCommands.add('ollama');
      const ctl = new HttpOllamaControl(probe);
      expect(await ctl.isInstalled()).toBe(true);
    });

    it('returns false when ollama command missing', async () => {
      const probe = new FakePlatformProbe();
      probe.availableCommands.delete('ollama');
      const ctl = new HttpOllamaControl(probe);
      expect(await ctl.isInstalled()).toBe(false);
    });
  });

  describe('isRunning', () => {
    it('returns true when /api/tags responds 200', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ models: [] }));
      const ctl = new HttpOllamaControl(new FakePlatformProbe());
      expect(await ctl.isRunning()).toBe(true);

      const [url] = fetchMock.mock.calls[0] ?? [];
      expect(url).toBe('http://localhost:11434/api/tags');
    });

    it('returns false when fetch rejects (connection refused)', async () => {
      fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const ctl = new HttpOllamaControl(new FakePlatformProbe());
      expect(await ctl.isRunning()).toBe(false);
    });

    it('returns false on non-2xx', async () => {
      fetchMock.mockResolvedValueOnce(new Response('err', { status: 500 }));
      const ctl = new HttpOllamaControl(new FakePlatformProbe());
      expect(await ctl.isRunning()).toBe(false);
    });
  });

  describe('version', () => {
    it('returns trimmed stdout on success', async () => {
      const probe = new FakePlatformProbe();
      setCommand(probe, 'ollama', ['--version'], { stdout: 'ollama version 0.1.40\n', stderr: '', code: 0 });
      const ctl = new HttpOllamaControl(probe);
      expect(await ctl.version()).toBe('ollama version 0.1.40');
    });

    it('returns null on non-zero exit', async () => {
      const probe = new FakePlatformProbe();
      setCommand(probe, 'ollama', ['--version'], { stdout: '', stderr: 'not found', code: 127 });
      const ctl = new HttpOllamaControl(probe);
      expect(await ctl.version()).toBeNull();
    });

    it('returns null on empty stdout', async () => {
      const probe = new FakePlatformProbe();
      setCommand(probe, 'ollama', ['--version'], { stdout: '   \n', stderr: '', code: 0 });
      const ctl = new HttpOllamaControl(probe);
      expect(await ctl.version()).toBeNull();
    });
  });

  describe('installViaBrew', () => {
    it('returns no-brew when brew is missing', async () => {
      const probe = new FakePlatformProbe();
      probe.availableCommands.delete('brew');
      const ctl = new HttpOllamaControl(probe);
      const r = await ctl.installViaBrew();
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.kind).toBe('no-brew');
      }
    });

    it('returns ok on success', async () => {
      const probe = new FakePlatformProbe();
      probe.availableCommands.add('brew');
      setCommand(probe, 'brew', ['install', 'ollama'], { stdout: 'installed', stderr: '', code: 0 });
      const ctl = new HttpOllamaControl(probe);
      expect(await ctl.installViaBrew()).toEqual({ ok: true });
    });

    it('classifies permission error', async () => {
      const probe = new FakePlatformProbe();
      probe.availableCommands.add('brew');
      setCommand(probe, 'brew', ['install', 'ollama'], {
        stdout: '',
        stderr: 'Permission denied: cannot write to /usr/local',
        code: 1,
      });
      const ctl = new HttpOllamaControl(probe);
      const r = await ctl.installViaBrew();
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.kind).toBe('permission');
      }
    });

    it('classifies network error', async () => {
      const probe = new FakePlatformProbe();
      probe.availableCommands.add('brew');
      setCommand(probe, 'brew', ['install', 'ollama'], {
        stdout: '',
        stderr: 'Could not resolve host: github.com',
        code: 1,
      });
      const ctl = new HttpOllamaControl(probe);
      const r = await ctl.installViaBrew();
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.kind).toBe('no-internet');
      }
    });
  });

  describe('installViaCurl', () => {
    it('returns no-curl when curl is missing', async () => {
      const probe = new FakePlatformProbe();
      probe.availableCommands.delete('curl');
      const ctl = new HttpOllamaControl(probe);
      const r = await ctl.installViaCurl();
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.kind).toBe('no-curl');
      }
    });

    it('runs install script when curl present', async () => {
      const probe = new FakePlatformProbe();
      probe.availableCommands.add('curl');
      setCommand(probe, 'sh', ['-c', 'curl -fsSL https://ollama.com/install.sh | sh'], {
        stdout: 'ok',
        stderr: '',
        code: 0,
      });
      const ctl = new HttpOllamaControl(probe);
      expect(await ctl.installViaCurl()).toEqual({ ok: true });
    });

    it('falls back to unknown on unclassified stderr', async () => {
      const probe = new FakePlatformProbe();
      probe.availableCommands.add('curl');
      setCommand(probe, 'sh', ['-c', 'curl -fsSL https://ollama.com/install.sh | sh'], {
        stdout: '',
        stderr: 'strange error',
        code: 1,
      });
      const ctl = new HttpOllamaControl(probe);
      const r = await ctl.installViaCurl();
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.kind).toBe('unknown');
        expect(r.details).toBe('strange error');
      }
    });
  });

  describe('startInBackground', () => {
    it('spawns `ollama serve` detached and unrefs', async () => {
      const unref = vi.fn();
      hoisted.spawn.mockReturnValueOnce({ unref });
      const ctl = new HttpOllamaControl(new FakePlatformProbe());
      await ctl.startInBackground();

      expect(hoisted.spawn).toHaveBeenCalledTimes(1);
      const [cmd, args, opts] = getSpawnCall(0);
      expect(cmd).toBe('ollama');
      expect(args).toEqual(['serve']);
      expect(opts).toMatchObject({ detached: true });
      expect(unref).toHaveBeenCalled();
    });

    it('opens log file when serveLogPath provided', async () => {
      const unref = vi.fn();
      hoisted.spawn.mockReturnValueOnce({ unref });
      hoisted.open.mockResolvedValueOnce({ fd: 42 });
      const ctl = new HttpOllamaControl(new FakePlatformProbe(), { serveLogPath: '/tmp/ollama.log' });
      await ctl.startInBackground();

      expect(hoisted.open).toHaveBeenCalledWith('/tmp/ollama.log', 'a');
      const [, , opts] = getSpawnCall(0);
      const stdio = opts['stdio'] as unknown[] | undefined;
      expect(stdio?.[1]).toBe(42);
      expect(stdio?.[2]).toBe(42);
    });

    it('falls back to ignore stdio when log open fails', async () => {
      const unref = vi.fn();
      hoisted.spawn.mockReturnValueOnce({ unref });
      hoisted.open.mockRejectedValueOnce(new Error('EACCES'));
      const ctl = new HttpOllamaControl(new FakePlatformProbe(), { serveLogPath: '/forbidden/log' });
      await ctl.startInBackground();

      const [, , opts] = getSpawnCall(0);
      const stdio = opts['stdio'] as unknown[] | undefined;
      expect(stdio).toEqual(['ignore', 'ignore', 'ignore']);
    });
  });

  describe('waitHealthy', () => {
    it('returns true when /api/tags becomes reachable', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ models: [] }));
      const ctl = new HttpOllamaControl(new FakePlatformProbe());
      expect(await ctl.waitHealthy(5000)).toBe(true);
    });

    it('returns false on timeout when never healthy', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
      const ctl = new HttpOllamaControl(new FakePlatformProbe());
      expect(await ctl.waitHealthy(10)).toBe(false);
    });
  });

  describe('listModels', () => {
    it('returns mapped models on success', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          models: [
            { name: 'nomic-embed-text', size: 100 },
            { name: 'qwen2', size: 5_000_000_000 },
          ],
        }),
      );
      const ctl = new HttpOllamaControl(new FakePlatformProbe());
      const list = await ctl.listModels();
      expect(list).toEqual([
        { name: 'nomic-embed-text', sizeBytes: 100 },
        { name: 'qwen2', sizeBytes: 5_000_000_000 },
      ]);
    });

    it('returns [] when fetch rejects', async () => {
      fetchMock.mockRejectedValueOnce(new Error('boom'));
      const ctl = new HttpOllamaControl(new FakePlatformProbe());
      expect(await ctl.listModels()).toEqual([]);
    });

    it('returns [] on non-2xx', async () => {
      fetchMock.mockResolvedValueOnce(new Response('', { status: 500 }));
      const ctl = new HttpOllamaControl(new FakePlatformProbe());
      expect(await ctl.listModels()).toEqual([]);
    });

    it('defaults sizeBytes to 0 when missing', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ models: [{ name: 'a' }] }));
      const ctl = new HttpOllamaControl(new FakePlatformProbe());
      expect(await ctl.listModels()).toEqual([{ name: 'a', sizeBytes: 0 }]);
    });
  });

  describe('pullModel', () => {
    it('streams progress events and returns ok on completion', async () => {
      const events = [
        JSON.stringify({ status: 'pulling manifest' }),
        JSON.stringify({ status: 'downloading', completed: 500, total: 1000 }),
        JSON.stringify({ status: 'success' }),
      ];
      fetchMock.mockResolvedValueOnce(ndjsonStreamResponse(events));

      const ctl = new HttpOllamaControl(new FakePlatformProbe());
      const progress: { pct: number; status: string }[] = [];
      const result = await ctl.pullModel('nomic-embed-text', (pct, status) => {
        progress.push({ pct, status });
      });
      expect(result).toEqual({ ok: true });
      expect(progress.at(-1)?.pct).toBe(100);
    });

    it('returns hub-down when /api/pull returns non-2xx', async () => {
      fetchMock.mockResolvedValueOnce(new Response('', { status: 502 }));
      const ctl = new HttpOllamaControl(new FakePlatformProbe());
      const r = await ctl.pullModel('m');
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.kind).toBe('hub-down');
      }
    });

    it('returns no-internet when fetch throws', async () => {
      fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'));
      const ctl = new HttpOllamaControl(new FakePlatformProbe());
      const r = await ctl.pullModel('m');
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.kind).toBe('no-internet');
      }
    });

    it('classifies stream error "no space" as no-space', async () => {
      const events = [JSON.stringify({ error: 'write error: no space left on device' })];
      fetchMock.mockResolvedValueOnce(ndjsonStreamResponse(events));
      const ctl = new HttpOllamaControl(new FakePlatformProbe());
      const r = await ctl.pullModel('m');
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.kind).toBe('no-space');
      }
    });

    it('classifies stream error "connection" as no-internet', async () => {
      const events = [JSON.stringify({ error: 'connection reset by peer' })];
      fetchMock.mockResolvedValueOnce(ndjsonStreamResponse(events));
      const ctl = new HttpOllamaControl(new FakePlatformProbe());
      const r = await ctl.pullModel('m');
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.kind).toBe('no-internet');
      }
    });
  });

  describe('probeEmbedding', () => {
    it('returns ok with dims on success', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ embedding: [0.1, 0.2, 0.3] }));
      const ctl = new HttpOllamaControl(new FakePlatformProbe());
      const r = await ctl.probeEmbedding('nomic-embed-text', 'hello');
      expect(r).toEqual({ ok: true, dims: 3 });
    });

    it('uses custom URL when provided', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ embedding: [0.1] }));
      const ctl = new HttpOllamaControl(new FakePlatformProbe());
      await ctl.probeEmbedding('m', 't', 'http://remote:11434/');

      const [url] = fetchMock.mock.calls[0] ?? [];
      expect(url).toBe('http://remote:11434/api/embeddings');
    });

    it('classifies 404 as model-not-found', async () => {
      fetchMock.mockResolvedValueOnce(new Response('model not found', { status: 404 }));
      const ctl = new HttpOllamaControl(new FakePlatformProbe());
      const r = await ctl.probeEmbedding('missing', 't');
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.kind).toBe('model-not-found');
      }
    });

    it('classifies non-2xx as no-response', async () => {
      fetchMock.mockResolvedValueOnce(new Response('boom', { status: 500 }));
      const ctl = new HttpOllamaControl(new FakePlatformProbe());
      const r = await ctl.probeEmbedding('m', 't');
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.kind).toBe('no-response');
      }
    });

    it('classifies missing embedding array as wrong-format', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({}));
      const ctl = new HttpOllamaControl(new FakePlatformProbe());
      const r = await ctl.probeEmbedding('m', 't');
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.kind).toBe('wrong-format');
      }
    });

    it('classifies non-number embedding entries as wrong-format', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ embedding: [0.1, 'oops'] }));
      const ctl = new HttpOllamaControl(new FakePlatformProbe());
      const r = await ctl.probeEmbedding('m', 't');
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.kind).toBe('wrong-format');
      }
    });

    it('classifies fetch rejection as no-response', async () => {
      fetchMock.mockRejectedValueOnce(new Error('network'));
      const ctl = new HttpOllamaControl(new FakePlatformProbe());
      const r = await ctl.probeEmbedding('m', 't');
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.kind).toBe('no-response');
      }
    });

    it('classifies AbortError as timeout', async () => {
      const abortErr = new Error('aborted');
      abortErr.name = 'AbortError';
      fetchMock.mockRejectedValueOnce(abortErr);
      const ctl = new HttpOllamaControl(new FakePlatformProbe());
      const r = await ctl.probeEmbedding('m', 't');
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.kind).toBe('timeout');
      }
    });
  });

  it('exposes adapter name', () => {
    const ctl = new HttpOllamaControl(new FakePlatformProbe());
    expect(ctl.name).toBe('HttpOllamaControl');
  });
});
