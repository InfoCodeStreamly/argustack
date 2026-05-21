import { describe, it, expect } from 'vitest';
import { hashFile } from '../../../src/code-intel/hash.js';

describe('hashFile', () => {
  it('returns 64-char hex sha256', () => {
    const hash = hashFile('export const x = 1;');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('is deterministic for the same input', () => {
    const a = hashFile('content');
    const b = hashFile('content');
    expect(a).toBe(b);
  });

  it('produces different hashes for different inputs', () => {
    const a = hashFile('alpha');
    const b = hashFile('beta');
    expect(a).not.toBe(b);
  });

  it('handles empty input', () => {
    const hash = hashFile('');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});
