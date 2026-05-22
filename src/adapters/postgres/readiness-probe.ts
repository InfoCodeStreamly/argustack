import { Client } from 'pg';
import type { IHubReadinessProbe } from '../../core/ports/hub-readiness-probe.js';

const PG_HEALTH_TIMEOUT_MS = 60_000;
const PG_HEALTH_INTERVAL_MS = 1_000;

/**
 * Adapter: polls the freshly-bootstrapped hub Postgres until it accepts
 * an authenticated `SELECT 1`. Bridges the {@link IHubReadinessProbe}
 * port — `BootstrapHubUseCase` knows nothing about pg.
 */
export class PgReadinessProbe implements IHubReadinessProbe {
  constructor(
    private readonly credentials: {
      readonly user: string;
      readonly password: string;
      readonly database: string;
      readonly host?: string;
    },
  ) {}

  async waitForReady(port: number): Promise<{ ok: true } | { ok: false; details: string }> {
    const deadline = Date.now() + PG_HEALTH_TIMEOUT_MS;
    let lastError = 'unknown';
    while (Date.now() < deadline) {
      const client = new Client({
        host: this.credentials.host ?? 'localhost',
        port,
        user: this.credentials.user,
        password: this.credentials.password,
        database: this.credentials.database,
        connectionTimeoutMillis: 2000,
      });
      try {
        await client.connect();
        await client.query('SELECT 1');
        await client.end();
        return { ok: true };
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        try { await client.end(); } catch { /* ignore */ }
        await new Promise((r) => setTimeout(r, PG_HEALTH_INTERVAL_MS));
      }
    }
    return {
      ok: false,
      details: `Postgres did not become ready in ${String(PG_HEALTH_TIMEOUT_MS / 1000)}s: ${lastError}`,
    };
  }
}
