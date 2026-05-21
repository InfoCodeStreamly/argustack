import { describe, it, expect } from 'vitest';
import { FakeCodeEmbedding } from '../../../fixtures/fakes/fake-code-embedding.js';

describe('ICodeEmbedding contract via FakeCodeEmbedding', () => {
  it('exposes dimensions, embedCode, embedQuery, rerank', async () => {
    const e = new FakeCodeEmbedding(8);
    expect(e.dimensions).toBe(8);
    const vecs = await e.embedCode([{ content: 'hello', kind: 'function' }]);
    expect(vecs).toHaveLength(1);
    expect(vecs[0]?.length).toBe(8);
    const qVec = await e.embedQuery('x');
    expect(qVec.length).toBe(8);
    const rer = await e.rerank('q', [{ id: 'a', content: 'something' }], 1);
    expect(rer).toHaveLength(1);
  });
});
