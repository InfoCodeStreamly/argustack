/**
 * Type-contract tests for `IDockerControl` port.
 *
 * The port itself is interface-only — runtime behaviour is exercised
 * through the {@link FakeDockerControl} fake that ships with the test
 * fixtures. These tests assert the port shape (method names exist, the
 * discriminated unions accept both success and classified failure) so a
 * future rename or signature change to the contract triggers a failure
 * before adapter or use-case tests do.
 */

import { describe, it, expect } from 'vitest';
import type {
  IDockerControl,
  DockerVersion,
  ComposeUpResult,
  ComposeUpErrorKind,
} from '../../../../src/core/ports/docker-control.js';
import { FakeDockerControl } from '../../../fixtures/fakes/fake-docker-control.js';

describe('IDockerControl port contract', () => {
  it('FakeDockerControl satisfies IDockerControl', () => {
    const fake: IDockerControl = new FakeDockerControl();

    expect(fake.name).toBeTruthy();
    expect(typeof fake.isInstalled).toBe('function');
    expect(typeof fake.isRunning).toBe('function');
    expect(typeof fake.version).toBe('function');
    expect(typeof fake.pollUntilRunning).toBe('function');
    expect(typeof fake.composeUp).toBe('function');
  });

  it('DockerVersion exposes engine and compose strings', () => {
    const version: DockerVersion = { engine: '24.0.0', compose: '2.20.0' };

    expect(version.engine).toBe('24.0.0');
    expect(version.compose).toBe('2.20.0');
  });

  it('ComposeUpResult discriminates on ok flag', () => {
    const variants: ComposeUpResult[] = [
      { ok: true },
      { ok: false, kind: 'permission', details: 'no perms' },
    ];

    const okVariant = variants[0];
    const failVariant = variants[1];
    expect(okVariant?.ok).toBe(true);
    if (failVariant !== undefined && !failVariant.ok) {
      expect(failVariant.kind).toBe('permission');
      expect(failVariant.details).toBe('no perms');
    }
  });

  it('ComposeUpErrorKind accepts every documented variant', () => {
    const kinds: ComposeUpErrorKind[] = [
      'permission',
      'compose-v1',
      'no-space',
      'port-in-use',
      'unknown',
    ];

    expect(kinds).toHaveLength(5);
    expect(new Set(kinds).size).toBe(5);
  });

  it('FakeDockerControl methods return promises', async () => {
    const fake = new FakeDockerControl();

    await expect(fake.isInstalled()).resolves.toBe(true);
    await expect(fake.isRunning()).resolves.toBe(true);
    await expect(fake.version()).resolves.toEqual({ engine: '24.0.0', compose: '2.20.0' });
  });
});
