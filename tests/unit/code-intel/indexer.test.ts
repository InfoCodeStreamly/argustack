import { describe, it, expect } from 'vitest';
import { CodeIndexer } from '../../../src/code-intel/indexer.js';
import { FakeCodeGraph } from '../../fixtures/fakes/fake-code-graph.js';
import { FakeCodeVectorStore } from '../../fixtures/fakes/fake-code-vector-store.js';
import { FakeCodeMetaStore } from '../../fixtures/fakes/fake-code-meta-store.js';
import { FakeCodeEmbedding } from '../../fixtures/fakes/fake-code-embedding.js';
import { FakeCodeParser } from '../../fixtures/fakes/fake-code-parser.js';
import { createCodeProject } from '../../fixtures/shared/test-constants.js';

describe('CodeIndexer (smoke)', () => {
  it('constructs without error and exposes indexProject/indexFile/removeFile', () => {
    const indexer = new CodeIndexer({
      project: createCodeProject(),
      parser: new FakeCodeParser(),
      graph: new FakeCodeGraph(),
      vec: new FakeCodeVectorStore(),
      embedding: new FakeCodeEmbedding(8),
      meta: new FakeCodeMetaStore(),
    });
    expect(typeof indexer.indexProject).toBe('function');
    expect(typeof indexer.indexFile).toBe('function');
    expect(typeof indexer.removeFile).toBe('function');
  });
});
