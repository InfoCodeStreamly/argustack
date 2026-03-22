import type { Knex } from 'knex';
import type { IDbProvider } from '../../core/ports/db-provider.js';
import type { QueryResult } from '../../core/ports/storage.js';
import type { DbSchemaBatch, DbEngine, DbTable } from '../../core/types/database.js';
import { createKnexClient, type DbConnectionConfig } from './client.js';
import { validateSql } from './sql-validator.js';
import {
  mapTableRow,
  mapColumnRow,
  mapForeignKeyRow,
  mapIndexRows,
  type RawTableRow,
  type RawColumnRow,
  type RawForeignKeyRow,
  type RawIndexRow,
} from './mapper.js';

const MAX_ROWS = 1000;

function extractRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) {
    return result as T[];
  }
  const obj = result as Record<string, unknown>;
  if (Array.isArray(obj['rows'])) {
    return obj['rows'] as T[];
  }
  if (Array.isArray(obj[0])) {
    return obj[0] as T[];
  }
  return [];
}

export class DbProvider implements IDbProvider {
  readonly name: string;
  readonly engine: DbEngine;
  private knex: Knex | null = null;
  private readonly config: DbConnectionConfig;

  constructor(config: DbConnectionConfig) {
    this.config = config;
    this.name = config.name || `${config.engine}:${config.database}`;
    this.engine = config.engine;
  }

  async connect(): Promise<void> {
    this.knex = createKnexClient(this.config);
    await this.knex.raw('SELECT 1');
  }

  async *introspect(): AsyncGenerator<DbSchemaBatch> {
    const db = this.requireConnection();
    const sourceName = this.config.name || this.config.database;

    const tables = await this.queryTables(db);
    const primaryKeys = await this.queryPrimaryKeys(db);
    const allColumns = await this.queryColumns(db);
    const foreignKeys = await this.queryForeignKeys(db);
    const indexes = await this.queryIndexes(db);

    const columnsByTable = new Map<string, typeof allColumns>();
    for (const col of allColumns) {
      const existing = columnsByTable.get(col.table_name) ?? [];
      existing.push(col);
      columnsByTable.set(col.table_name, existing);
    }

    const pkSet = new Set(primaryKeys.map((pk) => `${pk.table_name}.${pk.column_name}`));

    const dbTables: DbTable[] = tables.map((t) => {
      const mapped = mapTableRow(t, sourceName);
      const cols = columnsByTable.get(t.table_name) ?? [];
      return {
        ...mapped,
        columns: cols.map((c) => mapColumnRow(c, pkSet)),
      };
    });

    const dbForeignKeys = foreignKeys.map(mapForeignKeyRow);
    const dbIndexes = mapIndexRows(indexes);

    yield { tables: dbTables, foreignKeys: dbForeignKeys, indexes: dbIndexes };
  }

  async query(sql: string): Promise<QueryResult> {
    const db = this.requireConnection();

    const validation = validateSql(sql);
    if (!validation.valid) {
      throw new Error(`Query rejected: ${validation.reason}`);
    }

    const limitedSql = this.applyRowLimit(sql);

    const result: unknown = await db.raw(limitedSql);
    const rows = extractRows<Record<string, unknown>>(result);

    return { rows: rows.slice(0, MAX_ROWS) };
  }

  async getTableCount(): Promise<number> {
    const db = this.requireConnection();

    if (this.engine === 'postgresql' || this.engine === 'mysql') {
      const result: unknown = await db.raw(
        `SELECT COUNT(*) as count FROM information_schema.tables WHERE table_schema NOT IN ('information_schema', 'pg_catalog', 'mysql', 'performance_schema', 'sys')`,
      );
      const rows = extractRows<{ count: string | number }>(result);
      return Number(rows[0]?.count ?? 0);
    }

    return 0;
  }

  async disconnect(): Promise<void> {
    if (this.knex) {
      await this.knex.destroy();
      this.knex = null;
    }
  }

  private requireConnection(): Knex {
    if (!this.knex) {
      throw new Error('Not connected. Call connect() first.');
    }
    return this.knex;
  }

  private applyRowLimit(sql: string): string {
    const upper = sql.toUpperCase().trim();
    if (upper.includes('LIMIT')) {
      return sql;
    }
    const clean = sql.replace(/;\s*$/, '');
    return `${clean} LIMIT ${String(MAX_ROWS)}`;
  }

  private async queryTables(db: Knex): Promise<RawTableRow[]> {
    if (this.engine === 'postgresql') {
      const result: unknown = await db.raw(
        `SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema NOT IN ('information_schema', 'pg_catalog') AND table_type = 'BASE TABLE' ORDER BY table_schema, table_name`,
      );
      return extractRows<RawTableRow>(result);
    }

    if (this.engine === 'mysql') {
      const result: unknown = await db.raw(
        `SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE' ORDER BY table_name`,
      );
      return extractRows<RawTableRow>(result);
    }

    if (this.engine === 'mssql') {
      const result: unknown = await db.raw(
        `SELECT TABLE_SCHEMA as table_schema, TABLE_NAME as table_name FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_SCHEMA, TABLE_NAME`,
      );
      return extractRows<RawTableRow>(result);
    }

    if (this.engine === 'sqlite') {
      const result: unknown = await db.raw(
        `SELECT 'main' as table_schema, name as table_name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
      );
      return extractRows<RawTableRow>(result);
    }

    return [];
  }

  private async queryColumns(db: Knex): Promise<RawColumnRow[]> {
    if (this.engine === 'postgresql') {
      const result: unknown = await db.raw(
        `SELECT table_name, column_name, data_type, is_nullable, column_default, ordinal_position FROM information_schema.columns WHERE table_schema NOT IN ('information_schema', 'pg_catalog') ORDER BY table_name, ordinal_position`,
      );
      return extractRows<RawColumnRow>(result);
    }

    if (this.engine === 'mysql') {
      const result: unknown = await db.raw(
        `SELECT table_name, column_name, data_type, is_nullable, column_default, ordinal_position FROM information_schema.columns WHERE table_schema = DATABASE() ORDER BY table_name, ordinal_position`,
      );
      return extractRows<RawColumnRow>(result);
    }

    return [];
  }

  private async queryPrimaryKeys(db: Knex): Promise<{ table_name: string; column_name: string }[]> {
    if (this.engine === 'postgresql') {
      const result: unknown = await db.raw(
        `SELECT kcu.table_name, kcu.column_name FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema NOT IN ('information_schema', 'pg_catalog')`,
      );
      return extractRows<{ table_name: string; column_name: string }>(result);
    }

    if (this.engine === 'mysql') {
      const result: unknown = await db.raw(
        `SELECT TABLE_NAME as table_name, COLUMN_NAME as column_name FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND CONSTRAINT_NAME = 'PRIMARY'`,
      );
      return extractRows<{ table_name: string; column_name: string }>(result);
    }

    return [];
  }

  private async queryForeignKeys(db: Knex): Promise<RawForeignKeyRow[]> {
    if (this.engine === 'postgresql') {
      const result: unknown = await db.raw(
        `SELECT kcu.table_name, kcu.column_name, ccu.table_name AS referenced_table, ccu.column_name AS referenced_column FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema NOT IN ('information_schema', 'pg_catalog')`,
      );
      return extractRows<RawForeignKeyRow>(result);
    }

    if (this.engine === 'mysql') {
      const result: unknown = await db.raw(
        `SELECT TABLE_NAME as table_name, COLUMN_NAME as column_name, REFERENCED_TABLE_NAME as referenced_table, REFERENCED_COLUMN_NAME as referenced_column FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL`,
      );
      return extractRows<RawForeignKeyRow>(result);
    }

    return [];
  }

  private async queryIndexes(db: Knex): Promise<RawIndexRow[]> {
    if (this.engine === 'postgresql') {
      const result: unknown = await db.raw(
        `SELECT t.relname as table_name, i.relname as index_name, a.attname as column_name, ix.indisunique as is_unique, ix.indisprimary as is_primary FROM pg_class t JOIN pg_index ix ON t.oid = ix.indrelid JOIN pg_class i ON i.oid = ix.indexrelid JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey) JOIN pg_namespace n ON n.oid = t.relnamespace WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') ORDER BY t.relname, i.relname`,
      );
      return extractRows<RawIndexRow>(result);
    }

    return [];
  }
}
