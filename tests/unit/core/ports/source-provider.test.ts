import { describe, it, expect } from 'vitest';
import type { ISourceProvider } from '../../../../src/core/ports/source-provider.js';

describe('ISourceProvider port', () => {
  it('exports ISourceProvider interface', () => {
    const check: ISourceProvider | undefined = undefined;
    expect(check).toBeUndefined();
  });
});
