import { describe, it, expect } from 'vitest';
import type { IStorage, QueryResult } from '../../../../src/core/ports/storage.js';

describe('IStorage port', () => {
  it('exports IStorage interface', () => {
    const check: IStorage | undefined = undefined;
    expect(check).toBeUndefined();
  });

  it('exports QueryResult interface', () => {
    const result: QueryResult = { rows: [] };
    expect(result.rows).toEqual([]);
  });
});
