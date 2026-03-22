import type { IDbProvider } from '../../../src/core/ports/db-provider.js';
import type { QueryResult } from '../../../src/core/ports/storage.js';
import type { DbSchemaBatch, DbEngine } from '../../../src/core/types/database.js';

export class FakeDbProvider implements IDbProvider {
  readonly name: string;
  readonly engine: DbEngine;

  connected = false;
  disconnected = false;
  private readonly batches: DbSchemaBatch[];
  private readonly tableCount: number;
  private readonly queryRows: Record<string, unknown>[];

  constructor(options?: {
    name?: string;
    engine?: DbEngine;
    batches?: DbSchemaBatch[];
    tableCount?: number;
    queryRows?: Record<string, unknown>[];
  }) {
    this.name = options?.name ?? 'fake-db';
    this.engine = options?.engine ?? 'postgresql';
    this.batches = options?.batches ?? [];
    this.tableCount = options?.tableCount ?? 0;
    this.queryRows = options?.queryRows ?? [];
  }

  connect(): Promise<void> {
    this.connected = true;
    return Promise.resolve();
  }

  async *introspect(): AsyncGenerator<DbSchemaBatch> {
    await Promise.resolve();
    for (const batch of this.batches) {
      yield batch;
    }
  }

  query(_sql: string): Promise<QueryResult> {
    return Promise.resolve({ rows: this.queryRows });
  }

  getTableCount(): Promise<number> {
    return Promise.resolve(this.tableCount);
  }

  disconnect(): Promise<void> {
    this.disconnected = true;
    return Promise.resolve();
  }
}
