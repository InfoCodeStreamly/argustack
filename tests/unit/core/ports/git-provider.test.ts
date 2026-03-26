import { describe, it, expect } from 'vitest';
import type { IGitProvider } from '../../../../src/core/ports/git-provider.js';

describe('IGitProvider port', () => {
  it('exports IGitProvider interface', () => {
    const check: IGitProvider | undefined = undefined;
    expect(check).toBeUndefined();
  });
});
