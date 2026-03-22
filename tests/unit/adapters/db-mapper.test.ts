import { describe, it, expect } from 'vitest';
import {
  mapTableRow,
  mapColumnRow,
  mapForeignKeyRow,
  mapIndexRows,
} from '../../../src/adapters/db/mapper.js';
import { DB_TEST_IDS } from '../../fixtures/shared/test-constants.js';

describe('mapTableRow', () => {
  it('maps raw table row to DbTable (without columns)', () => {
    const result = mapTableRow(
      { table_schema: 'public', table_name: 'users' },
      DB_TEST_IDS.sourceName,
    );

    expect(result).toEqual({
      sourceName: DB_TEST_IDS.sourceName,
      schema: 'public',
      name: 'users',
      rowCount: null,
      sizeBytes: null,
    });
  });
});

describe('mapColumnRow', () => {
  it('maps raw column row with primary key detection', () => {
    const primaryKeys = new Set(['users.id']);

    const result = mapColumnRow(
      {
        table_name: 'users',
        column_name: 'id',
        data_type: 'integer',
        is_nullable: 'NO',
        column_default: null,
        ordinal_position: 1,
      },
      primaryKeys,
    );

    expect(result).toEqual({
      tableName: 'users',
      name: 'id',
      dataType: 'integer',
      nullable: false,
      defaultValue: null,
      isPrimaryKey: true,
      ordinalPosition: 1,
    });
  });

  it('maps nullable column with default', () => {
    const result = mapColumnRow(
      {
        table_name: 'users',
        column_name: 'email',
        data_type: 'varchar',
        is_nullable: 'YES',
        column_default: "''",
        ordinal_position: 2,
      },
      new Set(),
    );

    expect(result.nullable).toBe(true);
    expect(result.isPrimaryKey).toBe(false);
    expect(result.defaultValue).toBe("''");
  });
});

describe('mapForeignKeyRow', () => {
  it('maps raw foreign key row', () => {
    const result = mapForeignKeyRow({
      table_name: 'orders',
      column_name: 'user_id',
      referenced_table: 'users',
      referenced_column: 'id',
    });

    expect(result).toEqual({
      tableName: 'orders',
      columnName: 'user_id',
      referencedTable: 'users',
      referencedColumn: 'id',
    });
  });
});

describe('mapIndexRows', () => {
  it('groups multiple columns into one index', () => {
    const rows = [
      { table_name: 'users', index_name: 'idx_name_email', column_name: 'name', is_unique: false, is_primary: false },
      { table_name: 'users', index_name: 'idx_name_email', column_name: 'email', is_unique: false, is_primary: false },
    ];

    const result = mapIndexRows(rows);

    expect(result).toHaveLength(1);
    expect(result[0]?.columns).toEqual(['name', 'email']);
    expect(result[0]?.indexName).toBe('idx_name_email');
  });

  it('separates different indexes', () => {
    const rows = [
      { table_name: 'users', index_name: 'idx_a', column_name: 'a', is_unique: true, is_primary: false },
      { table_name: 'users', index_name: 'idx_b', column_name: 'b', is_unique: false, is_primary: true },
    ];

    const result = mapIndexRows(rows);

    expect(result).toHaveLength(2);
    expect(result[0]?.isUnique).toBe(true);
    expect(result[1]?.isPrimary).toBe(true);
  });

  it('returns empty array for empty input', () => {
    expect(mapIndexRows([])).toEqual([]);
  });
});
