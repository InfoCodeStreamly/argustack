/**
 * Type-contract tests for `IPlatformProbe` port. The port is
 * interface-only — these tests exercise the shape via the
 * {@link FakePlatformProbe} fake and verify the result types
 * (PortStatus discriminated union, CommandResult triple).
 */

import { describe, it, expect } from 'vitest';
import type {
  IPlatformProbe,
  OsKind,
  PortStatus,
  PortFree,
  PortInUse,
  CommandResult,
} from '../../../../src/core/ports/platform-probe.js';
import { FakePlatformProbe } from '../../../fixtures/fakes/fake-platform-probe.js';

describe('IPlatformProbe port contract', () => {
  it('FakePlatformProbe satisfies IPlatformProbe', () => {
    const probe: IPlatformProbe = new FakePlatformProbe();

    expect(probe.name).toBeTruthy();
    expect(typeof probe.detectOS).toBe('function');
    expect(typeof probe.hasCommand).toBe('function');
    expect(typeof probe.checkPort).toBe('function');
    expect(typeof probe.runCommand).toBe('function');
  });

  it('OsKind accepts every documented variant', () => {
    const kinds: OsKind[] = ['macos', 'linux', 'windows', 'unknown'];

    expect(kinds).toHaveLength(4);
    expect(new Set(kinds).size).toBe(4);
  });

  it('PortFree and PortInUse discriminate on the free flag', () => {
    const free: PortFree = { free: true, port: 15432 };
    const inUse: PortInUse = { free: false, port: 15432, pid: 99, processName: 'postgres' };
    const status: PortStatus = free;

    expect(status.free).toBe(true);
    expect(inUse.processName).toBe('postgres');
  });

  it('CommandResult exposes stdout, stderr, and exit code', () => {
    const result: CommandResult = { stdout: 'hi', stderr: '', code: 0 };

    expect(result.stdout).toBe('hi');
    expect(result.code).toBe(0);
  });

  it('FakePlatformProbe returns macos by default and free port when not configured', async () => {
    const probe = new FakePlatformProbe();

    expect(probe.detectOS()).toBe('macos');
    const status = await probe.checkPort(15432);
    expect(status.free).toBe(true);
    expect(status.port).toBe(15432);
  });
});
