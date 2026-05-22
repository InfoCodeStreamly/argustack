/**
 * Unit tests for CheckDimsConflictUseCase.
 *
 * Uses FakeCodeVectorStore to model Qdrant collection state.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CheckDimsConflictUseCase } from '../../../../src/use-cases/init/check-dims-conflict.js';
import { FakeCodeVectorStore } from '../../../fixtures/fakes/fake-code-vector-store.js';

const WORKSPACE_ID = 'ws-test';

describe('CheckDimsConflictUseCase', () => {
  let vec: FakeCodeVectorStore;
  let useCase: CheckDimsConflictUseCase;

  beforeEach(() => {
    vec = new FakeCodeVectorStore();
    useCase = new CheckDimsConflictUseCase(vec);
  });

  it('returns no-collection when nothing has been indexed yet', async () => {
    const result = await useCase.execute(WORKSPACE_ID, 1024);

    expect(result).toEqual({ conflict: false, reason: 'no-collection' });
  });

  it('returns matches when existing collection has the same dims', async () => {
    await vec.ensureCollection(WORKSPACE_ID, 1024);

    const result = await useCase.execute(WORKSPACE_ID, 1024);

    expect(result.conflict).toBe(false);
    if (result.conflict) { return; }
    expect(result.reason).toBe('matches');
    expect(result.existingDims).toBe(1024);
  });

  it('returns conflict with both dimensionalities when they differ', async () => {
    await vec.ensureCollection(WORKSPACE_ID, 768);

    const result = await useCase.execute(WORKSPACE_ID, 1024);

    expect(result.conflict).toBe(true);
    if (!result.conflict) { return; }
    expect(result.existingDims).toBe(768);
    expect(result.newDims).toBe(1024);
    expect(result.vectorCollection).toBe(`code_${WORKSPACE_ID}`);
    expect(result.projectId).toBe(WORKSPACE_ID);
  });
});
