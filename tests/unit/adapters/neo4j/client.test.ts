import { describe, it, expect, vi } from 'vitest';
import type { Driver } from 'neo4j-driver';
import { createDriver, openSession } from '../../../../src/adapters/neo4j/client.js';

vi.mock('neo4j-driver', () => ({
  default: {
    driver: vi.fn(() => ({ mock: 'driver' })),
    auth: { basic: vi.fn((u: string, p: string) => ({ u, p })) },
  },
}));

describe('neo4j/client', () => {
  it('createDriver builds driver with config', () => {
    const driver = createDriver({ uri: 'bolt://localhost', user: 'neo4j', password: 'pw' });
    expect(driver).toBeDefined();
  });

  it('openSession passes database param when provided', () => {
    const sessionFn = vi.fn();
    const driver = { session: sessionFn } as unknown as Driver;
    openSession(driver, 'mydb');
    expect(sessionFn).toHaveBeenCalledWith({ database: 'mydb' });
  });
});
