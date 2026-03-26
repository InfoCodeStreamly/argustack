import { describe, it, expect } from 'vitest';
import type { IGitHubProvider } from '../../../../src/core/ports/github-provider.js';

describe('IGitHubProvider port', () => {
  it('exports IGitHubProvider interface', () => {
    const check: IGitHubProvider | undefined = undefined;
    expect(check).toBeUndefined();
  });
});
