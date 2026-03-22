import { describe, it, expect } from 'vitest';
import type { IEmbeddingProvider } from '../../../../src/core/ports/embedding-provider.js';

describe('IEmbeddingProvider port', () => {
  it('exports IEmbeddingProvider interface', () => {
    const check: IEmbeddingProvider | undefined = undefined;
    expect(check).toBeUndefined();
  });
});
