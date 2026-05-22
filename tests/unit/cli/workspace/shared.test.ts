/**
 * Unit tests for cli/workspace/shared — sanitizeSlug helper and the
 * thin openHubStore wrapper. openHubStore's dynamic imports for
 * pg/PostgresWorkspaceStore are stubbed at module boundary.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../src/workspace/hub-config.js', () => ({
  loadHubConfig: vi.fn().mockReturnValue({
    db: { host: 'h', port: 5432, user: 'u', password: 'p', database: 'd' },
  }),
}));

const endFn = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../../src/adapters/postgres/index.js', () => ({
  createPool: vi.fn(() => ({ end: endFn })),
  PostgresWorkspaceStore: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this['name'] = 'pg';
  }),
}));

import { sanitizeSlug, openHubStore } from '../../../../src/cli/workspace/shared.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('sanitizeSlug', () => {
  it('lowercases input', () => {
    expect(sanitizeSlug('MyWorkspace')).toBe('myworkspace');
  });

  it('replaces non [a-z0-9-] characters with dashes', () => {
    expect(sanitizeSlug('hello world!')).toBe('hello-world');
  });

  it('collapses runs of dashes into a single dash', () => {
    expect(sanitizeSlug('a___b   c')).toBe('a-b-c');
  });

  it('strips leading and trailing dashes', () => {
    expect(sanitizeSlug('--foo--')).toBe('foo');
  });

  it('returns an empty string for input with no alphanumerics', () => {
    expect(sanitizeSlug('!!!')).toBe('');
  });

  it('preserves digits and existing dashes', () => {
    expect(sanitizeSlug('arg-263-v2')).toBe('arg-263-v2');
  });
});

describe('openHubStore', () => {
  it('returns a store and a close function', async () => {
    const { store, close } = await openHubStore();
    expect(store).toBeDefined();
    expect(typeof close).toBe('function');
  });

  it('close() drains the underlying pool', async () => {
    const { close } = await openHubStore();
    await close();
    expect(endFn).toHaveBeenCalled();
  });
});
