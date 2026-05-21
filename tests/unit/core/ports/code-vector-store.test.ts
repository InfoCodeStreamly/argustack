import { describe, it, expect } from 'vitest';
import { FakeCodeVectorStore } from '../../../fixtures/fakes/fake-code-vector-store.js';

describe('ICodeVectorStore contract via FakeCodeVectorStore', () => {
  it('Fake implements all required methods', () => {
    const v = new FakeCodeVectorStore();
    expect(typeof v.initialize).toBe('function');
    expect(typeof v.ensureCollection).toBe('function');
    expect(typeof v.upsertChunks).toBe('function');
    expect(typeof v.deleteByFile).toBe('function');
    expect(typeof v.deleteBySymbol).toBe('function');
    expect(typeof v.searchSemantic).toBe('function');
    expect(typeof v.findSimilar).toBe('function');
    expect(typeof v.getCollectionStats).toBe('function');
    expect(typeof v.deleteCollection).toBe('function');
    expect(typeof v.close).toBe('function');
  });
});
