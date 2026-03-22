import type { DbTable, DbColumn, DbForeignKey, DbIndex } from '../../core/types/database.js';

export interface RawTableRow {
  table_schema: string;
  table_name: string;
}

export interface RawColumnRow {
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
  ordinal_position: number;
}

export interface RawForeignKeyRow {
  table_name: string;
  column_name: string;
  referenced_table: string;
  referenced_column: string;
}

export interface RawIndexRow {
  table_name: string;
  index_name: string;
  column_name: string;
  is_unique: boolean;
  is_primary: boolean;
}

export function mapTableRow(row: RawTableRow, sourceName: string): Omit<DbTable, 'columns'> {
  return {
    sourceName,
    schema: row.table_schema,
    name: row.table_name,
    rowCount: null,
    sizeBytes: null,
  };
}

export function mapColumnRow(row: RawColumnRow, primaryKeys: Set<string>): DbColumn {
  const key = `${row.table_name}.${row.column_name}`;
  return {
    tableName: row.table_name,
    name: row.column_name,
    dataType: row.data_type,
    nullable: row.is_nullable === 'YES',
    defaultValue: row.column_default,
    isPrimaryKey: primaryKeys.has(key),
    ordinalPosition: row.ordinal_position,
  };
}

export function mapForeignKeyRow(row: RawForeignKeyRow): DbForeignKey {
  return {
    tableName: row.table_name,
    columnName: row.column_name,
    referencedTable: row.referenced_table,
    referencedColumn: row.referenced_column,
  };
}

export function mapIndexRows(rows: RawIndexRow[]): DbIndex[] {
  const grouped = new Map<string, { columns: string[]; isUnique: boolean; isPrimary: boolean; tableName: string }>();

  for (const row of rows) {
    const key = `${row.table_name}.${row.index_name}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.columns.push(row.column_name);
    } else {
      grouped.set(key, {
        tableName: row.table_name,
        columns: [row.column_name],
        isUnique: row.is_unique,
        isPrimary: row.is_primary,
      });
    }
  }

  return Array.from(grouped.entries()).map(([key, val]) => ({
    tableName: val.tableName,
    indexName: key.split('.')[1] ?? key,
    columns: val.columns,
    isUnique: val.isUnique,
    isPrimary: val.isPrimary,
  }));
}
