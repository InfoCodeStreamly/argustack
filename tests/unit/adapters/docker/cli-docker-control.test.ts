import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CliDockerControl } from '../../../../src/adapters/docker/index.js';
import { FakePlatformProbe } from '../../../fixtures/fakes/fake-platform-probe.js';
import type { CommandResult } from '../../../../src/core/ports/platform-probe.js';

function setCommand(probe: FakePlatformProbe, command: string, args: readonly string[], result: CommandResult): void {
  const key = `${command} ${args.join(' ')}`;
  probe.commandResults.set(key, result);
}

describe('CliDockerControl', () => {
  let probe: FakePlatformProbe;
  let docker: CliDockerControl;

  beforeEach(() => {
    probe = new FakePlatformProbe();
    docker = new CliDockerControl(probe);
  });

  describe('isInstalled', () => {
    it('returns true when docker command is on PATH', async () => {
      probe.availableCommands.add('docker');
      expect(await docker.isInstalled()).toBe(true);
    });

    it('returns false when docker command is missing', async () => {
      probe.availableCommands.delete('docker');
      expect(await docker.isInstalled()).toBe(false);
    });
  });

  describe('isRunning', () => {
    it('returns true when `docker info` exits 0', async () => {
      setCommand(probe, 'docker', ['info'], { stdout: 'Server info', stderr: '', code: 0 });
      expect(await docker.isRunning()).toBe(true);
    });

    it('returns false when `docker info` exits non-zero', async () => {
      setCommand(probe, 'docker', ['info'], { stdout: '', stderr: 'cannot connect', code: 1 });
      expect(await docker.isRunning()).toBe(false);
    });
  });

  describe('version', () => {
    it('returns engine + compose versions on success', async () => {
      setCommand(probe, 'docker', ['version', '--format', '{{.Server.Version}}'], {
        stdout: '24.0.5\n',
        stderr: '',
        code: 0,
      });
      setCommand(probe, 'docker', ['compose', 'version', '--short'], {
        stdout: '2.20.2\n',
        stderr: '',
        code: 0,
      });
      const v = await docker.version();
      expect(v).toEqual({ engine: '24.0.5', compose: '2.20.2' });
    });

    it('returns null when engine probe fails', async () => {
      setCommand(probe, 'docker', ['version', '--format', '{{.Server.Version}}'], {
        stdout: '',
        stderr: 'daemon down',
        code: 1,
      });
      expect(await docker.version()).toBeNull();
    });

    it('returns null when compose probe fails (engine OK)', async () => {
      setCommand(probe, 'docker', ['version', '--format', '{{.Server.Version}}'], {
        stdout: '24.0.5',
        stderr: '',
        code: 0,
      });
      setCommand(probe, 'docker', ['compose', 'version', '--short'], {
        stdout: '',
        stderr: 'compose v1',
        code: 1,
      });
      expect(await docker.version()).toBeNull();
    });
  });

  describe('pollUntilRunning', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('returns true immediately when already running', async () => {
      setCommand(probe, 'docker', ['info'], { stdout: '', stderr: '', code: 0 });
      const result = await docker.pollUntilRunning(5000, 100);
      expect(result).toBe(true);
    });

    it('returns false on timeout when never running', async () => {
      vi.useRealTimers();
      setCommand(probe, 'docker', ['info'], { stdout: '', stderr: 'err', code: 1 });
      const result = await docker.pollUntilRunning(20, 5);
      expect(result).toBe(false);
    });

    it('invokes onTick with seconds elapsed', async () => {
      vi.useRealTimers();
      setCommand(probe, 'docker', ['info'], { stdout: '', stderr: 'err', code: 1 });
      const ticks: number[] = [];
      await docker.pollUntilRunning(15, 5, (s) => ticks.push(s));
      expect(ticks.length).toBeGreaterThan(0);
      expect(ticks.every((t) => typeof t === 'number')).toBe(true);
    });
  });

  describe('composeUp', () => {
    it('returns ok:true on exit 0', async () => {
      setCommand(probe, 'docker', ['compose', '-f', '/p/docker-compose.yml', 'up', '-d'], {
        stdout: 'Container started',
        stderr: '',
        code: 0,
      });
      const result = await docker.composeUp('/p/docker-compose.yml', '/p');
      expect(result).toEqual({ ok: true });
    });

    it('classifies permission errors', async () => {
      setCommand(probe, 'docker', ['compose', '-f', '/p/c.yml', 'up', '-d'], {
        stdout: '',
        stderr: 'Error response from daemon: permission denied',
        code: 1,
      });
      const result = await docker.composeUp('/p/c.yml', '/p');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.kind).toBe('permission');
        expect(result.details).toContain('permission denied');
      }
    });

    it('classifies port-in-use errors', async () => {
      setCommand(probe, 'docker', ['compose', '-f', '/p/c.yml', 'up', '-d'], {
        stdout: '',
        stderr: 'Bind for 0.0.0.0:5432 failed: port is already allocated',
        code: 1,
      });
      const result = await docker.composeUp('/p/c.yml', '/p');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.kind).toBe('port-in-use');
      }
    });

    it('classifies no-space errors', async () => {
      setCommand(probe, 'docker', ['compose', '-f', '/p/c.yml', 'up', '-d'], {
        stdout: '',
        stderr: 'write /var/lib: no space left on device',
        code: 1,
      });
      const result = await docker.composeUp('/p/c.yml', '/p');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.kind).toBe('no-space');
      }
    });

    it('classifies compose-v1 errors', async () => {
      setCommand(probe, 'docker', ['compose', '-f', '/p/c.yml', 'up', '-d'], {
        stdout: '',
        stderr: 'compose command is not supported in this docker version',
        code: 1,
      });
      const result = await docker.composeUp('/p/c.yml', '/p');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.kind).toBe('compose-v1');
      }
    });

    it('falls back to unknown for unclassified errors', async () => {
      setCommand(probe, 'docker', ['compose', '-f', '/p/c.yml', 'up', '-d'], {
        stdout: '',
        stderr: 'mysterious failure',
        code: 1,
      });
      const result = await docker.composeUp('/p/c.yml', '/p');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.kind).toBe('unknown');
        expect(result.details).toBe('mysterious failure');
      }
    });

    it('falls back to stdout when stderr empty', async () => {
      setCommand(probe, 'docker', ['compose', '-f', '/p/c.yml', 'up', '-d'], {
        stdout: 'partial log',
        stderr: '',
        code: 1,
      });
      const result = await docker.composeUp('/p/c.yml', '/p');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.details).toBe('partial log');
      }
    });
  });

  it('exposes the adapter name', () => {
    expect(docker.name).toBe('CliDockerControl');
  });
});
