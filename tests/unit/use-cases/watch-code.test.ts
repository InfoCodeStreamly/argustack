import { describe, it, expect } from 'vitest';
import { WatchCodeUseCase } from '../../../src/use-cases/watch-code.js';
import { FakeCodeGraph } from '../../fixtures/fakes/fake-code-graph.js';
import { FakeCodeVectorStore } from '../../fixtures/fakes/fake-code-vector-store.js';
import { FakeCodeMetaStore } from '../../fixtures/fakes/fake-code-meta-store.js';
import { FakeCodeEmbedding } from '../../fixtures/fakes/fake-code-embedding.js';
import { FakeCodeParser } from '../../fixtures/fakes/fake-code-parser.js';

describe('WatchCodeUseCase (smoke)', () => {
  it('constructs and exposes start method', () => {
    const useCase = new WatchCodeUseCase(
      new FakeCodeParser(),
      new FakeCodeGraph(),
      new FakeCodeVectorStore(),
      new FakeCodeEmbedding(8),
      new FakeCodeMetaStore(),
    );
    expect(typeof useCase.start).toBe('function');
  });
});
