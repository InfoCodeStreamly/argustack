import type { IDbProvider } from '../core/ports/db-provider.js';
import type { IStorage } from '../core/ports/storage.js';

function noop(_message: string): void { /* intentional */ }

export interface PullDbOptions {
  onProgress?: (message: string) => void;
}

export interface PullDbResult {
  sourceName: string;
  tablesCount: number;
  columnsCount: number;
  foreignKeysCount: number;
  indexesCount: number;
}

/**
 * Use Case: Pull schema metadata from external database → save to Argustack storage.
 *
 * Same pattern as PullGitUseCase / PullGitHubUseCase.
 * Talks through IDbProvider and IStorage interfaces only.
 */
export class PullDbUseCase {
  constructor(
    private readonly db: IDbProvider,
    private readonly storage: IStorage,
  ) {}

  async execute(sourceName: string, options: PullDbOptions = {}): Promise<PullDbResult> {
    const log = options.onProgress ?? noop;

    await this.storage.initialize();

    log(`Connecting to ${this.db.name}...`);
    await this.db.connect();

    let total: number | null = null;
    try {
      total = await this.db.getTableCount();
    } catch { /* count unavailable */ }

    log(`Pulling schema from ${this.db.name}${total !== null ? ` (${String(total)} tables)` : ''}...`);

    await this.storage.deleteDbSchema(sourceName);

    const result: PullDbResult = {
      sourceName,
      tablesCount: 0,
      columnsCount: 0,
      foreignKeysCount: 0,
      indexesCount: 0,
    };

    try {
      for await (const batch of this.db.introspect()) {
        await this.storage.saveDbSchemaBatch(batch, sourceName);

        result.tablesCount += batch.tables.length;
        for (const table of batch.tables) {
          result.columnsCount += table.columns.length;
        }
        result.foreignKeysCount += batch.foreignKeys.length;
        result.indexesCount += batch.indexes.length;

        if (total !== null && total > 0) {
          const pct = Math.min(100, Math.round(result.tablesCount / total * 100));
          log(`  ${String(result.tablesCount)}/${String(total)} tables (${String(pct)}%)`);
        } else {
          log(`  ${String(result.tablesCount)} tables...`);
        }
      }
    } finally {
      await this.db.disconnect();
    }

    log(`  Done: ${String(result.tablesCount)} tables, ${String(result.columnsCount)} columns, ${String(result.foreignKeysCount)} FKs, ${String(result.indexesCount)} indexes`);
    return result;
  }
}
