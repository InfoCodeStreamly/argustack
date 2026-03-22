import { describe, it, expect } from 'vitest';
import type { IDbProvider } from '../../../../src/core/ports/db-provider.js';

describe('IDbProvider port', () => {
  it('exports IDbProvider interface', () => {
    const check: IDbProvider | undefined = undefined;
    expect(check).toBeUndefined();
  });
});
