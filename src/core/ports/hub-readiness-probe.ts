/**
 * Port: probe that polls a freshly-bootstrapped hub service until it
 * accepts authenticated traffic. Used by `BootstrapHubUseCase` between
 * `docker compose up -d` and the first schema-apply call.
 *
 * Implementations: {@link PgReadinessProbe} (real Postgres health
 * check), and in-memory test doubles. The probe owns its own timeout
 * and polling cadence — callers just await the result.
 */
export interface IHubReadinessProbe {
  /**
   * Resolve once the hub service is ready, or with `{ ok: false }` if
   * the probe gave up. Never throws.
   */
  waitForReady(port: number): Promise<{ ok: true } | { ok: false; details: string }>;
}
