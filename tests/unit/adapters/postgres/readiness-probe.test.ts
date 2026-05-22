/**
 * Unit tests for `PgReadinessProbe` — the IHubReadinessProbe adapter.
 *
 * Mocks `pg.Client` at the module boundary so the probe never opens a
 * real TCP socket. The first test covers the happy path (immediate
 * connect + SELECT 1). The remaining tests cover the timeout branch by
 * shortening the deadline via a stubbed `Date.now()` clock so the suite
 * stays in the sub-second range.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PgReadinessProbe as PgReadinessProbeType } from '../../../../src/adapters/postgres/readiness-probe.js';

interface MockClient {
  connect: ReturnType<typeof vi.fn>;
  query: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
}

const clientFactory = vi.fn();

vi.mock('pg', () => {
  class FakeClient {
    constructor(config: unknown) {
      return clientFactory(config) as FakeClient;
    }
  }
  return { Client: FakeClient };
});

type ProbeCtor = new (creds: {
  user: string;
  password: string;
  database: string;
  host?: string;
}) => PgReadinessProbeType;

let PgReadinessProbe: ProbeCtor;

beforeEach(async () => {
  vi.clearAllMocks();
  clientFactory.mockReset();
  const mod = await import('../../../../src/adapters/postgres/readiness-probe.js');
  PgReadinessProbe = mod.PgReadinessProbe;
});

function okClient(): MockClient {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }),
    end: vi.fn().mockResolvedValue(undefined),
  };
}

function failingClient(message: string): MockClient {
  return {
    connect: vi.fn().mockRejectedValue(new Error(message)),
    query: vi.fn(),
    end: vi.fn().mockResolvedValue(undefined),
  };
}

describe('PgReadinessProbe', () => {
  it('resolves ok on the first successful connect + SELECT 1', async () => {
    const client = okClient();
    clientFactory.mockReturnValueOnce(client);

    const probe = new PgReadinessProbe({ user: 'argustack', password: 'pwd', database: 'argustack_hub' });
    const result = await probe.waitForReady(15432);

    expect(result).toEqual({ ok: true });
    expect(client.connect).toHaveBeenCalledOnce();
    expect(client.query).toHaveBeenCalledWith('SELECT 1');
    expect(client.end).toHaveBeenCalledOnce();
  });

  it('passes credentials and port to pg.Client', async () => {
    const client = okClient();
    clientFactory.mockReturnValueOnce(client);

    const probe = new PgReadinessProbe({
      user: 'u',
      password: 'p',
      database: 'd',
      host: 'db.example.com',
    });
    await probe.waitForReady(5454);

    const config = clientFactory.mock.calls[0]?.[0] as {
      host?: string;
      port?: number;
      user?: string;
      password?: string;
      database?: string;
    };
    expect(config.host).toBe('db.example.com');
    expect(config.port).toBe(5454);
    expect(config.user).toBe('u');
    expect(config.password).toBe('p');
    expect(config.database).toBe('d');
  });

  it('defaults host to localhost when not provided', async () => {
    const client = okClient();
    clientFactory.mockReturnValueOnce(client);

    const probe = new PgReadinessProbe({ user: 'u', password: 'p', database: 'd' });
    await probe.waitForReady(15432);

    const config = clientFactory.mock.calls[0]?.[0] as { host?: string };
    expect(config.host).toBe('localhost');
  });

  it('returns ok: false with last error after the deadline elapses', async () => {
    clientFactory.mockReturnValue(failingClient('ECONNREFUSED'));

    const dateSequence = [0, 1_000, 70_000];
    let dateIndex = 0;
    const dateSpy = vi.spyOn(Date, 'now').mockImplementation(() => {
      const value = dateSequence[dateIndex] ?? 70_000;
      if (dateIndex < dateSequence.length - 1) {
        dateIndex += 1;
      }
      return value;
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });

    try {
      const probe = new PgReadinessProbe({ user: 'u', password: 'p', database: 'd' });
      const promise = probe.waitForReady(15432);
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.details).toMatch(/Postgres did not become ready/);
        expect(result.details).toMatch(/ECONNREFUSED/);
      }
    } finally {
      dateSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('ends the client even when connect fails', async () => {
    const client = failingClient('boom');
    clientFactory.mockReturnValue(client);

    const dateSequence = [0, 1_000, 70_000];
    let dateIndex = 0;
    const dateSpy = vi.spyOn(Date, 'now').mockImplementation(() => {
      const value = dateSequence[dateIndex] ?? 70_000;
      if (dateIndex < dateSequence.length - 1) {
        dateIndex += 1;
      }
      return value;
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });

    try {
      const probe = new PgReadinessProbe({ user: 'u', password: 'p', database: 'd' });
      const promise = probe.waitForReady(15432);
      await vi.runAllTimersAsync();
      await promise;

      expect(client.end).toHaveBeenCalled();
    } finally {
      dateSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});
