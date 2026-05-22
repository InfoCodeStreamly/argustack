/**
 * Type-contract tests for `IWorkspaceStore` port. The port itself is
 * interface-only — runtime behaviour is exercised through the
 * {@link FakeWorkspaceStore} fake. These tests assert the shape so a
 * future rename or signature change to the contract triggers a failure
 * before adapter or use-case tests do.
 */

import { describe, it, expect } from 'vitest';
import type { IWorkspaceStore } from '../../../../src/core/ports/workspace-store.js';
import { FakeWorkspaceStore } from '../../../fixtures/fakes/fake-workspace-store.js';

describe('IWorkspaceStore port contract', () => {
  it('FakeWorkspaceStore satisfies IWorkspaceStore', () => {
    const store: IWorkspaceStore = new FakeWorkspaceStore();

    expect(store.name).toBeTruthy();
    expect(typeof store.initialize).toBe('function');
    expect(typeof store.create).toBe('function');
    expect(typeof store.getById).toBe('function');
    expect(typeof store.getByName).toBe('function');
    expect(typeof store.list).toBe('function');
    expect(typeof store.updateSettings).toBe('function');
    expect(typeof store.remove).toBe('function');
    expect(typeof store.touchActive).toBe('function');
    expect(typeof store.close).toBe('function');
  });

  it('create returns the persisted workspace shape', async () => {
    const store = new FakeWorkspaceStore();

    const persisted = await store.create({ id: 'demo', name: 'demo' });

    expect(persisted.id).toBe('demo');
    expect(persisted.name).toBe('demo');
    expect(persisted.createdAt).toBeTruthy();
    expect(persisted.lastActiveAt).toBeTruthy();
  });

  it('list returns workspaces ordered by lastActiveAt desc', async () => {
    const store = new FakeWorkspaceStore();
    await store.create({ id: 'a', name: 'a', lastActiveAt: '2026-01-01T00:00:00.000Z' });
    await store.create({ id: 'b', name: 'b', lastActiveAt: '2026-05-01T00:00:00.000Z' });

    const result = await store.list();

    expect(result.map((w) => w.id)).toEqual(['b', 'a']);
  });

  it('remove deletes the workspace', async () => {
    const store = new FakeWorkspaceStore();
    await store.create({ id: 'x', name: 'x' });

    await store.remove('x');

    expect(await store.getById('x')).toBeNull();
  });
});
