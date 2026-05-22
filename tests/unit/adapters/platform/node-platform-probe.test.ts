import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';

interface MockChild extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: (signal?: string) => boolean;
}

const hoisted = vi.hoisted(() => {
  const spawn = vi.fn();
  return { spawn };
});

vi.mock('node:child_process', () => ({
  spawn: hoisted.spawn,
}));

import { NodePlatformProbe } from '../../../../src/adapters/platform/index.js';

function makeChild(): MockChild {
  const child = new EventEmitter() as MockChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

async function nextTick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function getSpawnCall(index: number): { cmd: string; args: readonly string[] } {
  const raw = hoisted.spawn.mock.calls[index] as unknown;
  if (!Array.isArray(raw)) {
    throw new Error(`spawn has no call at index ${String(index)}`);
  }
  return {
    cmd: raw[0] as string,
    args: raw[1] as readonly string[],
  };
}

interface ProcWithPlatform {
  platform: NodeJS.Platform;
}

function setPlatform(value: NodeJS.Platform): NodeJS.Platform {
  const proc = process as unknown as ProcWithPlatform;
  const original = proc.platform;
  Object.defineProperty(process, 'platform', { value, configurable: true });
  return original;
}

function restorePlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value, configurable: true });
}

beforeEach(() => {
  hoisted.spawn.mockReset();
});

describe('NodePlatformProbe', () => {
  describe('detectOS', () => {
    it('returns macos for darwin', () => {
      const original = setPlatform('darwin');
      try {
        expect(new NodePlatformProbe().detectOS()).toBe('macos');
      } finally {
        restorePlatform(original);
      }
    });

    it('returns linux for linux', () => {
      const original = setPlatform('linux');
      try {
        expect(new NodePlatformProbe().detectOS()).toBe('linux');
      } finally {
        restorePlatform(original);
      }
    });

    it('returns windows for win32', () => {
      const original = setPlatform('win32');
      try {
        expect(new NodePlatformProbe().detectOS()).toBe('windows');
      } finally {
        restorePlatform(original);
      }
    });

    it('returns unknown for unrecognised platform', () => {
      const original = setPlatform('freebsd');
      try {
        expect(new NodePlatformProbe().detectOS()).toBe('unknown');
      } finally {
        restorePlatform(original);
      }
    });
  });

  describe('runCommand', () => {
    it('resolves with stdout/stderr/code on clean exit', async () => {
      const child = makeChild();
      hoisted.spawn.mockReturnValueOnce(child);

      const probe = new NodePlatformProbe();
      const promise = probe.runCommand('echo', ['hi']);

      await nextTick();
      child.stdout.emit('data', Buffer.from('hi\n'));
      child.stderr.emit('data', Buffer.from(''));
      child.emit('close', 0);

      const result = await promise;
      expect(result.stdout).toBe('hi\n');
      expect(result.stderr).toBe('');
      expect(result.code).toBe(0);
    });

    it('aggregates multiple data chunks', async () => {
      const child = makeChild();
      hoisted.spawn.mockReturnValueOnce(child);

      const probe = new NodePlatformProbe();
      const promise = probe.runCommand('cat', []);

      await nextTick();
      child.stdout.emit('data', Buffer.from('foo'));
      child.stdout.emit('data', Buffer.from('bar'));
      child.stderr.emit('data', Buffer.from('warn:'));
      child.stderr.emit('data', Buffer.from(' x'));
      child.emit('close', 0);

      const result = await promise;
      expect(result.stdout).toBe('foobar');
      expect(result.stderr).toBe('warn: x');
    });

    it('returns code=127 when spawn emits error', async () => {
      const child = makeChild();
      hoisted.spawn.mockReturnValueOnce(child);

      const probe = new NodePlatformProbe();
      const promise = probe.runCommand('missing', []);

      await nextTick();
      child.emit('error', new Error('ENOENT'));

      const result = await promise;
      expect(result.code).toBe(127);
      expect(result.stderr).toContain('ENOENT');
    });

    it('handles non-zero exit codes', async () => {
      const child = makeChild();
      hoisted.spawn.mockReturnValueOnce(child);

      const probe = new NodePlatformProbe();
      const promise = probe.runCommand('false', []);

      await nextTick();
      child.stderr.emit('data', Buffer.from('failure'));
      child.emit('close', 1);

      const result = await promise;
      expect(result.code).toBe(1);
      expect(result.stderr).toBe('failure');
    });

    it('treats null exit code as 0', async () => {
      const child = makeChild();
      hoisted.spawn.mockReturnValueOnce(child);

      const probe = new NodePlatformProbe();
      const promise = probe.runCommand('cmd', []);

      await nextTick();
      child.emit('close', null);

      const result = await promise;
      expect(result.code).toBe(0);
    });
  });

  describe('hasCommand', () => {
    it('uses `which` on POSIX and returns true on exit 0', async () => {
      const original = setPlatform('darwin');
      try {
        const child = makeChild();
        hoisted.spawn.mockReturnValueOnce(child);

        const probe = new NodePlatformProbe();
        const promise = probe.hasCommand('docker');

        await nextTick();
        child.emit('close', 0);

        expect(await promise).toBe(true);
        const { cmd, args } = getSpawnCall(0);
        expect(cmd).toBe('which');
        expect(args).toEqual(['docker']);
      } finally {
        restorePlatform(original);
      }
    });

    it('uses `where` on Windows', async () => {
      const original = setPlatform('win32');
      try {
        const child = makeChild();
        hoisted.spawn.mockReturnValueOnce(child);

        const probe = new NodePlatformProbe();
        const promise = probe.hasCommand('docker');

        await nextTick();
        child.emit('close', 0);

        expect(await promise).toBe(true);
        const { cmd } = getSpawnCall(0);
        expect(cmd).toBe('where');
      } finally {
        restorePlatform(original);
      }
    });

    it('returns false on non-zero exit', async () => {
      const original = setPlatform('linux');
      try {
        const child = makeChild();
        hoisted.spawn.mockReturnValueOnce(child);

        const probe = new NodePlatformProbe();
        const promise = probe.hasCommand('nope');

        await nextTick();
        child.emit('close', 1);

        expect(await promise).toBe(false);
      } finally {
        restorePlatform(original);
      }
    });
  });

  describe('checkPort', () => {
    it('returns free on Windows without invoking lsof', async () => {
      const original = setPlatform('win32');
      try {
        const probe = new NodePlatformProbe();
        const status = await probe.checkPort(5432);
        expect(status).toEqual({ free: true, port: 5432 });
        expect(hoisted.spawn).not.toHaveBeenCalled();
      } finally {
        restorePlatform(original);
      }
    });

    it('returns free when lsof exits non-zero', async () => {
      const original = setPlatform('darwin');
      try {
        const child = makeChild();
        hoisted.spawn.mockReturnValueOnce(child);

        const probe = new NodePlatformProbe();
        const promise = probe.checkPort(5432);

        await nextTick();
        child.emit('close', 1);

        const status = await promise;
        expect(status).toEqual({ free: true, port: 5432 });
      } finally {
        restorePlatform(original);
      }
    });

    it('returns free when lsof stdout is empty', async () => {
      const original = setPlatform('linux');
      try {
        const child = makeChild();
        hoisted.spawn.mockReturnValueOnce(child);

        const probe = new NodePlatformProbe();
        const promise = probe.checkPort(5432);

        await nextTick();
        child.stdout.emit('data', Buffer.from(''));
        child.emit('close', 0);

        const status = await promise;
        expect(status).toEqual({ free: true, port: 5432 });
      } finally {
        restorePlatform(original);
      }
    });

    it('parses lsof output for occupied port', async () => {
      const original = setPlatform('darwin');
      try {
        const child = makeChild();
        hoisted.spawn.mockReturnValueOnce(child);

        const probe = new NodePlatformProbe();
        const promise = probe.checkPort(5432);

        const output = [
          'COMMAND  PID  USER  FD  TYPE  DEVICE  SIZE/OFF  NODE  NAME',
          'postgres 1234 eugene 5u IPv4  0xabc     0t0     TCP   *:5432 (LISTEN)',
        ].join('\n');

        await nextTick();
        child.stdout.emit('data', Buffer.from(output));
        child.emit('close', 0);

        const status = await promise;
        expect(status.free).toBe(false);
        if (!status.free) {
          expect(status.port).toBe(5432);
          expect(status.pid).toBe(1234);
          expect(status.processName).toBe('postgres');
        }
      } finally {
        restorePlatform(original);
      }
    });

    it('handles malformed lsof output gracefully (pid=0)', async () => {
      const original = setPlatform('linux');
      try {
        const child = makeChild();
        hoisted.spawn.mockReturnValueOnce(child);

        const probe = new NodePlatformProbe();
        const promise = probe.checkPort(8080);

        const output = ['HEADER LINE', 'mystery notnumeric'].join('\n');

        await nextTick();
        child.stdout.emit('data', Buffer.from(output));
        child.emit('close', 0);

        const status = await promise;
        expect(status.free).toBe(false);
        if (!status.free) {
          expect(status.processName).toBe('mystery');
          expect(status.pid).toBe(0);
        }
      } finally {
        restorePlatform(original);
      }
    });
  });

  it('exposes adapter name', () => {
    expect(new NodePlatformProbe().name).toBe('NodePlatformProbe');
  });
});
