export type DbEngine = 'postgresql' | 'mysql' | 'mssql' | 'sqlite' | 'oracledb';

export interface DbColumn {
  tableName: string;
  name: string;
  dataType: string;
  nullable: boolean;
  defaultValue: string | null;
  isPrimaryKey: boolean;
  ordinalPosition: number;
}

export interface DbTable {
  sourceName: string;
  schema: string;
  name: string;
  rowCount: number | null;
  sizeBytes: number | null;
  columns: DbColumn[];
}

export interface DbForeignKey {
  tableName: string;
  columnName: string;
  referencedTable: string;
  referencedColumn: string;
}

export interface DbIndex {
  tableName: string;
  indexName: string;
  columns: string[];
  isUnique: boolean;
  isPrimary: boolean;
}

export interface DbSchemaBatch {
  tables: DbTable[];
  foreignKeys: DbForeignKey[];
  indexes: DbIndex[];
}
