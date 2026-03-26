/**
 * Tests for the ClaudeSkillRunner adapter.
 *
 * Verifies process spawning behaviour, availability detection, and
 * execution cancellation. Uses vi.mock for node:child_process so no
 * real processes are started during tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

const { mockSpawn } = vi.hoisted(() => ({ mockSpawn: vi.fn() }));

vi.mock('node:child_process', () => ({
  spawn: mockSpawn,
}));

import { ClaudeSkillRunner } from '../../../../src/adapters/board/skill-runner.js';

class FakeStream extends EventEmitter {
  setEncoding(_enc: string): void {
    /* stub */
  }
}

interface FakeProcess extends EventEmitter {
  stdout: FakeStream;
  stderr: FakeStream;
  kill: ReturnType<typeof vi.fn>;
  pid: number;
}

function createFakeProcess(): FakeProcess {
  const proc = new EventEmitter() as FakeProcess;
  proc.stdout = new FakeStream();
  proc.stderr = new FakeStream();
  proc.kill = vi.fn();
  proc.pid = 12345;
  return proc;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ClaudeSkillRunner', () => {
  describe('constructor', () => {
    it('creates an instance without throwing', () => {
      expect(() => new ClaudeSkillRunner()).not.toThrow();
    });
  });

  describe('isAvailable', () => {
    it('returns true when claude exits with code 0', async () => {
      const proc = createFakeProcess();
      mockSpawn.mockReturnValue(proc);

      const runner = new ClaudeSkillRunner();
      const promise = runner.isAvailable();

      proc.emit('close', 0);

      const result = await promise;
      expect(result).toBe(true);
    });

    it('returns false when claude exits with non-zero code', async () => {
      const proc = createFakeProcess();
      mockSpawn.mockReturnValue(proc);

      const runner = new ClaudeSkillRunner();
      const promise = runner.isAvailable();

      proc.emit('close', 1);

      const result = await promise;
      expect(result).toBe(false);
    });

    it('returns false when spawn emits an error event', async () => {
      const proc = createFakeProcess();
      mockSpawn.mockReturnValue(proc);

      const runner = new ClaudeSkillRunner();
      const promise = runner.isAvailable();

      proc.emit('error', new Error('spawn ENOENT'));

      const result = await promise;
      expect(result).toBe(false);
    });

    it('invokes spawn with the --version flag', async () => {
      const proc = createFakeProcess();
      mockSpawn.mockReturnValue(proc);

      const runner = new ClaudeSkillRunner();
      const promise = runner.isAvailable();
      proc.emit('close', 0);
      await promise;

      expect(mockSpawn).toHaveBeenCalledWith(
        'claude',
        ['--version'],
        expect.objectContaining({ stdio: ['ignore', 'pipe', 'pipe'] }),
      );
    });
  });

  describe('execute', () => {
    it('spawns claude with the correct prompt argument', async () => {
      const proc = createFakeProcess();
      mockSpawn.mockReturnValue(proc);

      const runner = new ClaudeSkillRunner();
      const gen = runner.execute('code-review', ['file.ts', '--strict']);

      const iterPromise = gen.next();
      proc.emit('close');
      await iterPromise;

      expect(mockSpawn).toHaveBeenCalledWith(
        'claude',
        ['-p', '/code-review file.ts --strict'],
        expect.objectContaining({ stdio: ['ignore', 'pipe', 'pipe'] }),
      );
    });

    it('yields stdout chunks emitted by the child process', async () => {
      const proc = createFakeProcess();
      mockSpawn.mockReturnValue(proc);

      const runner = new ClaudeSkillRunner();
      const gen = runner.execute('summarize', []);

      const firstChunkPromise = gen.next();

      proc.stdout.emit('data', 'Hello from stdout');
      proc.emit('close');

      const firstChunk = await firstChunkPromise;
      expect(firstChunk.value).toBe('Hello from stdout');
    });

    it('yields stderr chunks emitted by the child process', async () => {
      const proc = createFakeProcess();
      mockSpawn.mockReturnValue(proc);

      const runner = new ClaudeSkillRunner();
      const gen = runner.execute('summarize', []);

      const firstChunkPromise = gen.next();

      proc.stderr.emit('data', 'Warning: something happened');
      proc.emit('close');

      const firstChunk = await firstChunkPromise;
      expect(firstChunk.value).toBe('Warning: something happened');
    });

    it('terminates generator after process close event', async () => {
      const proc = createFakeProcess();
      mockSpawn.mockReturnValue(proc);

      const runner = new ClaudeSkillRunner();
      const gen = runner.execute('noop', []);

      const chunks: string[] = [];
      const collectPromise = (async () => {
        for await (const chunk of gen) {
          chunks.push(chunk);
        }
      })();

      proc.stdout.emit('data', 'chunk-1');
      proc.emit('close');

      await collectPromise;

      expect(chunks).toEqual(['chunk-1']);
    });

    it('increments execution counter for each execute call', async () => {
      const proc1 = createFakeProcess();
      const proc2 = createFakeProcess();
      mockSpawn
        .mockReturnValueOnce(proc1)
        .mockReturnValueOnce(proc2);

      const runner = new ClaudeSkillRunner();

      const gen1 = runner.execute('skill-a', []);
      const gen2 = runner.execute('skill-b', []);

      const [result1, result2] = await Promise.all([
        (async () => {
          const p = gen1.next();
          setImmediate(() => proc1.emit('close'));
          return p;
        })(),
        (async () => {
          const p = gen2.next();
          setImmediate(() => proc2.emit('close'));
          return p;
        })(),
      ]);

      expect(result1.done).toBe(true);
      expect(result2.done).toBe(true);
      expect(mockSpawn).toHaveBeenCalledTimes(2);
    });

    it('handles process error event without propagating an unhandled error', async () => {
      const proc = createFakeProcess();
      mockSpawn.mockReturnValue(proc);

      const runner = new ClaudeSkillRunner();
      const gen = runner.execute('broken', []);

      const iterPromise = gen.next();

      proc.emit('error', new Error('spawn failed'));
      proc.emit('close');

      const result = await iterPromise;
      expect(result.done).toBe(true);
    });
  });

  describe('cancel', () => {
    it('does nothing when executionId is not tracked', () => {
      const runner = new ClaudeSkillRunner();
      expect(() => { runner.cancel('non-existent-id'); }).not.toThrow();
    });

    it('kills the tracked process with SIGTERM', () => {
      const proc = createFakeProcess();
      mockSpawn.mockReturnValue(proc);

      const runner = new ClaudeSkillRunner();
      const gen = runner.execute('long-running', []);

      void gen.next();

      runner.cancel('1');

      expect(proc.kill).toHaveBeenCalledWith('SIGTERM');

      proc.emit('close');
    });

    it('removes the process from internal map after cancel', () => {
      const proc = createFakeProcess();
      mockSpawn.mockReturnValue(proc);

      const runner = new ClaudeSkillRunner();
      const gen = runner.execute('task', []);
      void gen.next();

      runner.cancel('1');
      runner.cancel('1');

      expect(proc.kill).toHaveBeenCalledTimes(1);

      proc.emit('close');
    });
  });
});
