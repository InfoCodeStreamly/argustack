/**
 * Unit tests for ValidateWorkspaceNameUseCase.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ValidateWorkspaceNameUseCase } from '../../../../src/use-cases/init/validate-workspace-name.js';
import { FakeWorkspaceStore } from '../../../fixtures/fakes/fake-workspace-store.js';

describe('ValidateWorkspaceNameUseCase', () => {
  let store: FakeWorkspaceStore;
  let useCase: ValidateWorkspaceNameUseCase;

  beforeEach(() => {
    store = new FakeWorkspaceStore();
    useCase = new ValidateWorkspaceNameUseCase(store);
  });

  it('returns action=create for a fresh valid slug', async () => {
    const result = await useCase.execute('my-workspace');

    expect(result).toEqual({ ok: true, action: 'create', id: 'my-workspace', name: 'my-workspace' });
  });

  it('lowercases and replaces invalid characters when slugifying', async () => {
    const result = await useCase.execute('My Workspace!');

    expect(result.ok).toBe(true);
    if (!result.ok) { return; }
    expect(result.id).toBe('my-workspace');
    expect(result.action).toBe('create');
  });

  it('returns action=switch when a workspace with the slug already exists', async () => {
    await store.create({ id: 'existing-ws', name: 'existing-ws' });

    const result = await useCase.execute('existing-ws');

    expect(result).toEqual({ ok: true, action: 'switch', id: 'existing-ws', name: 'existing-ws' });
  });

  it('returns empty failure for whitespace-only input', async () => {
    const result = await useCase.execute('   ');

    expect(result).toEqual({ ok: false, reason: 'empty' });
  });

  it('returns invalid-slug when slugification yields an empty string (edge case)', async () => {
    const result = await useCase.execute('!!!');

    expect(result.ok).toBe(false);
    if (result.ok) { return; }
    expect(result.reason).toBe('invalid-slug');
  });
});
