import { describe, it, expect } from 'vitest';
import { withJobLock } from '../../../src/code-intel/job-lock.js';
import { FakeCodeMetaStore } from '../../fixtures/fakes/fake-code-meta-store.js';

describe('withJobLock', () => {
  it('acquires + releases lock around fn', async () => {
    const meta = new FakeCodeMetaStore();
    const result = await withJobLock('p1', meta, async () => Promise.resolve(42));
    expect(result).toBe(42);
    expect(meta.locks.has('p1')).toBe(false);
  });

  it('throws if lock cannot be acquired', async () => {
    const meta = new FakeCodeMetaStore();
    meta.locks.add('p1');
    await expect(withJobLock('p1', meta, async () => Promise.resolve(0))).rejects.toThrow(/Another indexing job/);
  });

  it('releases lock on error', async () => {
    const meta = new FakeCodeMetaStore();
    await expect(
      withJobLock('p1', meta, async () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');
    expect(meta.locks.has('p1')).toBe(false);
  });
});
