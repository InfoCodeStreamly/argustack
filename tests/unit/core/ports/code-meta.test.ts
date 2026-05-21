import { describe, it, expect } from 'vitest';
import { FakeCodeMetaStore } from '../../../fixtures/fakes/fake-code-meta-store.js';
import { createCodeProject } from '../../../fixtures/shared/test-constants.js';

describe('ICodeMetaStore contract via FakeCodeMetaStore', () => {
  it('register + getById round trip', async () => {
    const m = new FakeCodeMetaStore();
    const p = createCodeProject();
    await m.registerProject(p);
    expect(await m.getProjectById(p.id)).toEqual(p);
  });

  it('lock acquire/release', async () => {
    const m = new FakeCodeMetaStore();
    expect(await m.tryAcquireLock('x')).toBe(true);
    expect(await m.tryAcquireLock('x')).toBe(false);
    await m.releaseLock('x');
    expect(await m.tryAcquireLock('x')).toBe(true);
  });
});
