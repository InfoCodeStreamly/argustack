/**
 * Unit tests for createPool.
 *
 * Verifies that the factory function creates a pg.Pool with the correct
 * connection parameters. The pg module is mocked at the module boundary
 * so no real database connections are established.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPool = vi.fn(function (this: Record<string, unknown>, _config: unknown) {
  Object.assign(this, { query: vi.fn(), end: vi.fn(), connect: vi.fn() });
});

vi.mock('pg', () => ({
  default: { Pool: mockPool },
}));

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let createPool: typeof import('../../../../src/adapters/postgres/connection.js').createPool;

beforeEach(async () => {
  vi.clearAllMocks();
  const module = await import('../../../../src/adapters/postgres/connection.js');
  createPool = module.createPool;
});

const BASE_CONFIG = {
  host: 'localhost',
  port: 5434,
  user: 'argustack',
  password: 'argustack_local',
  database: 'argustack',
} as const;

describe('createPool', () => {
  it('constructs pg.Pool with the provided connection config', () => {
    createPool(BASE_CONFIG);

    expect(mockPool).toHaveBeenCalledOnce();
    const [config] = mockPool.mock.calls[0] as [{
      host: string; port: number; user: string; password: string; database: string;
    }];
    expect(config.host).toBe('localhost');
    expect(config.port).toBe(5434);
    expect(config.user).toBe('argustack');
    expect(config.password).toBe('argustack_local');
    expect(config.database).toBe('argustack');
  });

  it('sets pool max to 5', () => {
    createPool(BASE_CONFIG);

    const [config] = mockPool.mock.calls[0] as [{ max: number }];
    expect(config.max).toBe(5);
  });

  it('returns the constructed pool instance', () => {
    const result = createPool(BASE_CONFIG);

    expect(result).toBeInstanceOf(mockPool);
  });

  it('creates a fresh pool per call with different configs', () => {
    const configA = { ...BASE_CONFIG, host: 'host-a', port: 5432 };
    const configB = { ...BASE_CONFIG, host: 'host-b', port: 5433 };

    createPool(configA);
    createPool(configB);

    expect(mockPool).toHaveBeenCalledTimes(2);
    const [firstConfig] = mockPool.mock.calls[0] as [{ host: string; port: number }];
    const [secondConfig] = mockPool.mock.calls[1] as [{ host: string; port: number }];
    expect(firstConfig.host).toBe('host-a');
    expect(firstConfig.port).toBe(5432);
    expect(secondConfig.host).toBe('host-b');
    expect(secondConfig.port).toBe(5433);
  });

  it('forwards all config fields verbatim', () => {
    const customConfig = {
      host: 'db.prod.example.com',
      port: 5432,
      user: 'readonly',
      password: 'sup3rs3cr3t',
      database: 'myapp_prod',
    };

    createPool(customConfig);

    const [config] = mockPool.mock.calls[0] as [typeof customConfig & { max: number }];
    expect(config.host).toBe(customConfig.host);
    expect(config.port).toBe(customConfig.port);
    expect(config.user).toBe(customConfig.user);
    expect(config.password).toBe(customConfig.password);
    expect(config.database).toBe(customConfig.database);
  });
});
