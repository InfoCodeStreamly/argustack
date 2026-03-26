import { describe, it, expect } from 'vitest';
import type { IBoardStore } from '../../../../src/core/ports/board-store.js';

describe('IBoardStore port', () => {
  it('exports IBoardStore interface', () => {
    const check: IBoardStore | undefined = undefined;
    expect(check).toBeUndefined();
  });
});
