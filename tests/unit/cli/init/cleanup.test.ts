/**
 * Unit tests for cli/init/cleanup — handler registry around SIGINT/SIGTERM.
 * We verify ordering (LIFO) and the disposer returned by onCleanup.
 *
 * NOTE: the cleanup module installs signal listeners once per process
 * (module-level `installed` flag). To get a fresh registry between cases
 * we use vi.resetModules() inside beforeEach.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as CleanupMod from '../../../../src/cli/init/cleanup.js';

let onCleanup: typeof CleanupMod.onCleanup;

beforeEach(async () => {
  vi.resetModules();
  vi.restoreAllMocks();
  const mod = await import('../../../../src/cli/init/cleanup.js');
  onCleanup = mod.onCleanup;
});

describe('onCleanup', () => {
  it('returns a disposer function', () => {
    const disposer = onCleanup(() => undefined);
    expect(typeof disposer).toBe('function');
    disposer();
  });

  it('registers handlers that fire in LIFO order on SIGINT', async () => {
    const order: string[] = [];
    onCleanup(() => { order.push('first'); });
    onCleanup(() => { order.push('second'); });

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    try {
      process.emit('SIGINT' as never);
      await new Promise((resolve) => { setImmediate(resolve); });
    } finally {
      exitSpy.mockRestore();
    }

    expect(order).toEqual(['second', 'first']);
  });

  it('disposer removes a handler so it does not fire', async () => {
    const fired: string[] = [];
    const dispose = onCleanup(() => { fired.push('one'); });
    dispose();
    onCleanup(() => { fired.push('two'); });

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    try {
      process.emit('SIGTERM' as never);
      await new Promise((resolve) => { setImmediate(resolve); });
    } finally {
      exitSpy.mockRestore();
    }

    expect(fired).toEqual(['two']);
  });

  it('swallows handler errors and still exits', async () => {
    onCleanup(() => { throw new Error('boom'); });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    try {
      process.emit('SIGINT' as never);
      await new Promise((resolve) => { setImmediate(resolve); });
      expect(exitSpy).toHaveBeenCalledWith(130);
    } finally {
      exitSpy.mockRestore();
    }
  });

  it('uses exit code 1 for SIGTERM and 130 for SIGINT', async () => {
    onCleanup(() => undefined);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    try {
      process.emit('SIGTERM' as never);
      await new Promise((resolve) => { setImmediate(resolve); });
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      exitSpy.mockRestore();
    }
  });
});
