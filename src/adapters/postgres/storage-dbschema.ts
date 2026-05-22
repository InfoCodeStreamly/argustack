import type pg from 'pg';
import type { DbSchemaBatch } from '../../core/types/database.js';

/**
 * Per-aggregate storage module: external application database schema
 * mirror (`db_tables`, `db_columns`, `db_foreign_keys`, `db_indexes`).
 * Orchestrated by `PostgresStorage`.
 */
export class PostgresDbSchemaStorage {
  constructor(private readonly pool: pg.Pool) {}

  async saveDbSchemaBatch(workspaceId: string, batch: DbSchemaBatch, sourceName: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      for (const table of batch.tables) {
        await client.query(
          `INSERT INTO db_tables (workspace_id, source_name, table_schema, table_name, row_count, size_bytes)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (workspace_id, source_name, table_schema, table_name) DO UPDATE SET
             row_count = EXCLUDED.row_count,
             size_bytes = EXCLUDED.size_bytes,
             pulled_at = NOW()`,
          [workspaceId, sourceName, table.schema, table.name, table.rowCount, table.sizeBytes],
        );

        for (const col of table.columns) {
          await client.query(
            `INSERT INTO db_columns (workspace_id, source_name, table_schema, table_name, column_name, data_type, is_nullable, default_value, is_primary_key, ordinal_position)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             ON CONFLICT (workspace_id, source_name, table_schema, table_name, column_name) DO UPDATE SET
               data_type = EXCLUDED.data_type,
               is_nullable = EXCLUDED.is_nullable,
               default_value = EXCLUDED.default_value,
               is_primary_key = EXCLUDED.is_primary_key,
               ordinal_position = EXCLUDED.ordinal_position`,
            [workspaceId, sourceName, table.schema, table.name, col.name, col.dataType, col.nullable, col.defaultValue, col.isPrimaryKey, col.ordinalPosition],
          );
        }
      }

      for (const fk of batch.foreignKeys) {
        await client.query(
          `INSERT INTO db_foreign_keys (workspace_id, source_name, table_name, column_name, referenced_table, referenced_column)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (workspace_id, source_name, table_name, column_name, referenced_table, referenced_column) DO NOTHING`,
          [workspaceId, sourceName, fk.tableName, fk.columnName, fk.referencedTable, fk.referencedColumn],
        );
      }

      for (const idx of batch.indexes) {
        await client.query(
          `INSERT INTO db_indexes (workspace_id, source_name, table_name, index_name, columns, is_unique, is_primary)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (workspace_id, source_name, table_name, index_name) DO UPDATE SET
             columns = EXCLUDED.columns,
             is_unique = EXCLUDED.is_unique,
             is_primary = EXCLUDED.is_primary`,
          [workspaceId, sourceName, idx.tableName, idx.indexName, idx.columns, idx.isUnique, idx.isPrimary],
        );
      }

      await client.query('COMMIT');
    } catch (err: unknown) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async deleteDbSchema(workspaceId: string, sourceName: string): Promise<void> {
    await this.pool.query(
      'DELETE FROM db_indexes WHERE workspace_id = $1 AND source_name = $2',
      [workspaceId, sourceName],
    );
    await this.pool.query(
      'DELETE FROM db_foreign_keys WHERE workspace_id = $1 AND source_name = $2',
      [workspaceId, sourceName],
    );
    await this.pool.query(
      'DELETE FROM db_columns WHERE workspace_id = $1 AND source_name = $2',
      [workspaceId, sourceName],
    );
    await this.pool.query(
      'DELETE FROM db_tables WHERE workspace_id = $1 AND source_name = $2',
      [workspaceId, sourceName],
    );
  }
}
