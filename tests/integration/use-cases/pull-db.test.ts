import { describe, it, expect, beforeEach } from 'vitest';
import { PullDbUseCase } from '../../../src/use-cases/pull-db.js';
import { FakeDbProvider } from '../../fixtures/fakes/fake-db-provider.js';
import { FakeStorage } from '../../fixtures/fakes/fake-storage.js';
import { createDbSchemaBatch, createDbTable, createDbColumn, DB_TEST_IDS } from '../../fixtures/shared/test-constants.js';
import type { DbSchemaBatch } from '../../../src/core/types/database.js';

describe('PullDbUseCase', () => {
  let storage: FakeStorage;
  let provider: FakeDbProvider;
  let useCase: PullDbUseCase;

  beforeEach(() => {
    storage = new FakeStorage();
    const batch = createDbSchemaBatch();
    provider = new FakeDbProvider({
      batches: [batch],
      tableCount: 1,
    });
    useCase = new PullDbUseCase(provider, storage);
  });

  it('initializes storage', async () => {
    await useCase.execute(DB_TEST_IDS.sourceName);
    expect(storage.initialized).toBe(true);
  });

  it('connects and disconnects the DB provider', async () => {
    await useCase.execute(DB_TEST_IDS.sourceName);
    expect(provider.connected).toBe(true);
    expect(provider.disconnected).toBe(true);
  });

  it('deletes old schema before saving new one', async () => {
    await useCase.execute(DB_TEST_IDS.sourceName);
    expect(storage.deletedDbSources).toContain(DB_TEST_IDS.sourceName);
  });

  it('saves schema batches from provider', async () => {
    await useCase.execute(DB_TEST_IDS.sourceName);
    expect(storage.savedDbBatches).toHaveLength(1);
    expect(storage.savedDbBatches[0]?.sourceName).toBe(DB_TEST_IDS.sourceName);
    expect(storage.savedDbBatches[0]?.batch.tables).toHaveLength(1);
  });

  it('returns correct result counts', async () => {
    const result = await useCase.execute(DB_TEST_IDS.sourceName);
    expect(result.sourceName).toBe(DB_TEST_IDS.sourceName);
    expect(result.tablesCount).toBe(1);
    expect(result.columnsCount).toBe(1);
    expect(result.foreignKeysCount).toBe(1);
    expect(result.indexesCount).toBe(1);
  });

  it('accumulates counts across multiple batches', async () => {
    const batch1 = createDbSchemaBatch();
    const batch2 = createDbSchemaBatch();
    const multiProvider = new FakeDbProvider({
      batches: [batch1, batch2],
      tableCount: 2,
    });
    const multiUseCase = new PullDbUseCase(multiProvider, storage);

    const result = await multiUseCase.execute(DB_TEST_IDS.sourceName);
    expect(result.tablesCount).toBe(2);
    expect(result.foreignKeysCount).toBe(2);
    expect(result.indexesCount).toBe(2);
  });

  it('handles empty introspection', async () => {
    const emptyProvider = new FakeDbProvider({ batches: [], tableCount: 0 });
    const emptyUseCase = new PullDbUseCase(emptyProvider, storage);

    const result = await emptyUseCase.execute(DB_TEST_IDS.sourceName);
    expect(result.tablesCount).toBe(0);
    expect(result.columnsCount).toBe(0);
  });

  it('calls onProgress callback', async () => {
    const messages: string[] = [];
    await useCase.execute(DB_TEST_IDS.sourceName, {
      onProgress: (msg) => messages.push(msg),
    });

    expect(messages.length).toBeGreaterThan(0);
    expect(messages.some((m) => m.includes('Connecting'))).toBe(true);
    expect(messages.some((m) => m.includes('Done'))).toBe(true);
  });

  it('disconnects even if introspection fails', async () => {
    const failProvider = new FakeDbProvider({ batches: [] });
    failProvider.connect = () => Promise.resolve();
    failProvider.disconnect = () => { failProvider.disconnected = true; return Promise.resolve(); };
    const originalIntrospect = failProvider.introspect.bind(failProvider);
    failProvider.introspect = async function* () {
      yield* originalIntrospect();
      throw new Error('Introspection failed');
    };

    const failUseCase = new PullDbUseCase(failProvider, storage);

    await expect(failUseCase.execute(DB_TEST_IDS.sourceName)).rejects.toThrow('Introspection failed');
    expect(failProvider.disconnected).toBe(true);
  });

  it('counts columns from all tables in a batch', async () => {
    const batchWithMultipleColumns = createDbSchemaBatch({
      tables: [
        createDbTable({ columns: [createDbColumn(), createDbColumn({ name: DB_TEST_IDS.columnName2, ordinalPosition: 2 }), createDbColumn({ name: 'created_at', ordinalPosition: 3 })] }),
      ],
      foreignKeys: [],
      indexes: [],
    });
    const multiColProvider = new FakeDbProvider({ batches: [batchWithMultipleColumns], tableCount: 1 });
    const multiColUseCase = new PullDbUseCase(multiColProvider, storage);

    const result = await multiColUseCase.execute(DB_TEST_IDS.sourceName);

    expect(result.tablesCount).toBe(1);
    expect(result.columnsCount).toBe(3);
  });

  it('shows percentage in progress when table count available', async () => {
    const messages: string[] = [];
    await useCase.execute(DB_TEST_IDS.sourceName, {
      onProgress: (msg) => messages.push(msg),
    });

    expect(messages.some((m) => m.includes('1/1 tables (100%)'))).toBe(true);
  });

  it('shows count without percentage when table count is zero', async () => {
    const noCountProvider = new FakeDbProvider({
      batches: [createDbSchemaBatch()],
      tableCount: 0,
    });
    const noCountUseCase = new PullDbUseCase(noCountProvider, storage);

    const messages: string[] = [];
    await noCountUseCase.execute(DB_TEST_IDS.sourceName, {
      onProgress: (msg) => messages.push(msg),
    });

    expect(messages.some((m) => m.includes('1 tables...'))).toBe(true);
    expect(messages.some((m) => m.includes('%'))).toBe(false);
  });

  it('progress message includes table count from header', async () => {
    const messages: string[] = [];
    await useCase.execute(DB_TEST_IDS.sourceName, {
      onProgress: (msg) => messages.push(msg),
    });

    expect(messages.some((m) => m.includes('(1 tables)'))).toBe(true);
  });

  it('done message includes exact table, column, FK and index counts', async () => {
    const messages: string[] = [];
    await useCase.execute(DB_TEST_IDS.sourceName, {
      onProgress: (msg) => messages.push(msg),
    });

    expect(messages.some((m) =>
      m.includes('1 tables') &&
      m.includes('1 columns') &&
      m.includes('1 FKs') &&
      m.includes('1 indexes'),
    )).toBe(true);
  });

  it('deletes old schema before accumulating new results', async () => {
    const deletionOrder: string[] = [];

    const trackingStorage = new (class extends FakeStorage {
      override deleteDbSchema(sourceName: string): Promise<void> {
        deletionOrder.push(`delete:${sourceName}`);
        return super.deleteDbSchema(sourceName);
      }

      override saveDbSchemaBatch(batch: DbSchemaBatch, sourceName: string): Promise<void> {
        deletionOrder.push(`save:${sourceName}`);
        return super.saveDbSchemaBatch(batch, sourceName);
      }
    })();

    const trackingUseCase = new PullDbUseCase(provider, trackingStorage);
    await trackingUseCase.execute(DB_TEST_IDS.sourceName);

    const deleteIdx = deletionOrder.indexOf(`delete:${DB_TEST_IDS.sourceName}`);
    const saveIdx = deletionOrder.indexOf(`save:${DB_TEST_IDS.sourceName}`);
    expect(deleteIdx).toBeGreaterThanOrEqual(0);
    expect(saveIdx).toBeGreaterThan(deleteIdx);
  });

  it('progress percentage is capped at 100 when tables exceed reported total', async () => {
    const batch = createDbSchemaBatch({
      tables: [
        createDbTable({ name: 'a', columns: [createDbColumn()] }),
        createDbTable({ name: 'b', columns: [createDbColumn()] }),
        createDbTable({ name: 'c', columns: [createDbColumn()] }),
      ],
    });
    const bigProvider = new FakeDbProvider({ batches: [batch], tableCount: 1 });
    const bigUseCase = new PullDbUseCase(bigProvider, storage);

    const messages: string[] = [];
    await bigUseCase.execute(DB_TEST_IDS.sourceName, { onProgress: (msg) => messages.push(msg) });

    const percentMatches = messages.filter((m) => m.includes('%'));
    for (const msg of percentMatches) {
      const pctMatch = /\((\d+)%\)/.exec(msg);
      if (pctMatch) {
        expect(Number(pctMatch[1])).toBeLessThanOrEqual(100);
      }
    }
  });
});
