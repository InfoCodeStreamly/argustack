import { describe, it, expect } from 'vitest';
import { chunkToPoint, pointToHit, hashId } from '../../../../src/adapters/qdrant/mapper.js';
import { createCodeChunk } from '../../../fixtures/shared/test-constants.js';

describe('qdrant/mapper', () => {
  it('chunkToPoint produces stable hashId + payload', () => {
    const c = createCodeChunk();
    const p = chunkToPoint(c, [0.1, 0.2, 0.3]);
    expect(p.id).toHaveLength(32);
    expect(p.vector).toEqual([0.1, 0.2, 0.3]);
    expect(p.payload['symbolId']).toBe(c.symbolId);
    expect(p.payload['filePath']).toBe(c.filePath);
  });

  it('pointToHit maps payload back to SemanticHit', () => {
    const hit = pointToHit({
      id: 'x',
      score: 0.42,
      payload: {
        projectId: 'p',
        filePath: 'a.ts',
        layer: 'domain',
        kind: 'function',
        name: 'foo',
        startLine: 1,
        endLine: 5,
      },
    });
    expect(hit.score).toBe(0.42);
    expect(hit.payload.kind).toBe('function');
  });

  it('hashId is stable across calls', () => {
    expect(hashId('x')).toBe(hashId('x'));
    expect(hashId('x')).not.toBe(hashId('y'));
  });
});
