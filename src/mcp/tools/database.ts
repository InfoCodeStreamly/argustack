import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v4';
import type { DbEngine } from '../../core/types/database.js';
import {
  loadWorkspace,
  createAdapters,
  textResponse,
  errorResponse,
  getErrorMessage,
  str,
} from '../helpers.js';

interface DbTableRow {
  source_name: string;
  table_schema: string;
  table_name: string;
  row_count: number | null;
  size_bytes: number | null;
}

interface DbColumnRow {
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: boolean;
  default_value: string | null;
  is_primary_key: boolean;
  ordinal_position: number;
}

interface DbFkRow {
  table_name: string;
  column_name: string;
  referenced_table: string;
  referenced_column: string;
}

interface DbIndexRow {
  table_name: string;
  index_name: string;
  columns: string[];
  is_unique: boolean;
  is_primary: boolean;
}

interface DbStatsRow {
  total_tables: string;
  total_columns: string;
  total_fks: string;
  total_indexes: string;
}

interface SchemaGroupRow {
  table_schema: string;
  table_count: string;
  total_rows: string;
}

interface LargestTableRow {
  table_name: string;
  row_count: number;
  size_bytes: number;
}

export function registerDatabaseTools(server: McpServer): void {
  server.registerTool(
    'db_schema',
    {
      description: 'Browse the schema of an external database connected to Argustack. Shows tables, columns, foreign keys, and indexes. Use table parameter to get details for a specific table.',
      inputSchema: {
        table: z.string().optional().describe('Filter by table name (exact or partial match)'),
        schema: z.string().optional().describe('Filter by schema name (e.g. "public", "dbo")'),
        source: z.string().optional().describe('Filter by source name (if multiple databases synced)'),
      },
    },
    async ({ table, schema, source }) => {
      const ws = loadWorkspace();
      if (!ws.ok) {
        return errorResponse(`Workspace not found: ${ws.reason}`);
      }

      const { storage } = await createAdapters(ws.root);

      try {
        await storage.initialize();

        const conditions: string[] = [];
        const params: unknown[] = [];
        let paramIdx = 1;

        if (source) {
          conditions.push(`source_name = $${String(paramIdx)}`);
          params.push(source);
          paramIdx++;
        }
        if (schema) {
          conditions.push(`table_schema = $${String(paramIdx)}`);
          params.push(schema);
          paramIdx++;
        }
        if (table) {
          conditions.push(`table_name ILIKE $${String(paramIdx)}`);
          params.push(`%${table}%`);
          paramIdx++;
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        const tablesResult = await storage.query(
          `SELECT source_name, table_schema, table_name, row_count, size_bytes
           FROM db_tables ${where}
           ORDER BY table_schema, table_name
           LIMIT 200`,
          params,
        );

        if (tablesResult.rows.length === 0) {
          return textResponse('No tables found. Run `argustack sync db` to pull schema from the target database.');
        }

        const columnsResult = await storage.query(
          `SELECT table_name, column_name, data_type, is_nullable, default_value, is_primary_key, ordinal_position
           FROM db_columns ${where}
           ORDER BY table_name, ordinal_position`,
          params,
        );

        const fksResult = await storage.query(
          `SELECT table_name, column_name, referenced_table, referenced_column
           FROM db_foreign_keys ${where}
           ORDER BY table_name, column_name`,
          params,
        );

        const indexesResult = await storage.query(
          `SELECT table_name, index_name, columns, is_unique, is_primary
           FROM db_indexes ${where}
           ORDER BY table_name, index_name`,
          params,
        );

        const colsByTable = new Map<string, DbColumnRow[]>();
        for (const row of columnsResult.rows) {
          const col = row as unknown as DbColumnRow;
          const arr = colsByTable.get(col.table_name) ?? [];
          arr.push(col);
          colsByTable.set(col.table_name, arr);
        }

        const fksByTable = new Map<string, DbFkRow[]>();
        for (const row of fksResult.rows) {
          const fk = row as unknown as DbFkRow;
          const arr = fksByTable.get(fk.table_name) ?? [];
          arr.push(fk);
          fksByTable.set(fk.table_name, arr);
        }

        const idxByTable = new Map<string, DbIndexRow[]>();
        for (const row of indexesResult.rows) {
          const idx = row as unknown as DbIndexRow;
          const arr = idxByTable.get(idx.table_name) ?? [];
          arr.push(idx);
          idxByTable.set(idx.table_name, arr);
        }

        const lines: string[] = [`Database Schema (${String(tablesResult.rows.length)} tables)`, ''];

        for (const row of tablesResult.rows) {
          const t = row as unknown as DbTableRow;
          const sizeStr = t.size_bytes ? ` (${formatBytes(t.size_bytes)})` : '';
          const rowStr = t.row_count !== null ? `, ~${String(t.row_count)} rows` : '';
          lines.push(`## ${t.table_schema}.${t.table_name}${sizeStr}${rowStr}`);

          const cols = colsByTable.get(t.table_name) ?? [];
          for (const c of cols) {
            const pk = c.is_primary_key ? ' PK' : '';
            const nullable = c.is_nullable ? ' NULL' : ' NOT NULL';
            const def = c.default_value ? ` DEFAULT ${c.default_value}` : '';
            lines.push(`  ${c.column_name}: ${c.data_type}${pk}${nullable}${def}`);
          }

          const tableFks = fksByTable.get(t.table_name) ?? [];
          if (tableFks.length > 0) {
            lines.push('  Foreign keys:');
            for (const fk of tableFks) {
              lines.push(`    ${fk.column_name} → ${fk.referenced_table}.${fk.referenced_column}`);
            }
          }

          const tableIdx = idxByTable.get(t.table_name) ?? [];
          if (tableIdx.length > 0) {
            lines.push('  Indexes:');
            for (const idx of tableIdx) {
              const unique = idx.is_unique ? ' UNIQUE' : '';
              lines.push(`    ${idx.index_name}${unique}: (${idx.columns.join(', ')})`);
            }
          }

          lines.push('');
        }

        return textResponse(lines.join('\n'));
      } catch (err: unknown) {
        return errorResponse(`Failed to read DB schema: ${getErrorMessage(err)}`);
      } finally {
        await storage.close();
      }
    },
  );

  server.registerTool(
    'db_query',
    {
      description: 'Execute a read-only SQL query against the external database connected to Argustack. Only SELECT, EXPLAIN, SHOW, DESCRIBE, and WITH+SELECT are allowed. Results are limited to 1000 rows with a 30s timeout.',
      inputSchema: {
        sql: z.string().describe('SQL query to execute (read-only: SELECT, EXPLAIN, SHOW, DESCRIBE)'),
      },
    },
    async ({ sql }) => {
      const ws = loadWorkspace();
      if (!ws.ok) {
        return errorResponse(`Workspace not found: ${ws.reason}`);
      }

      try {
        const dotenv = await import('dotenv');
        dotenv.config({ path: `${ws.root}/.env`, quiet: true });

        const engine = (process.env['TARGET_DB_ENGINE'] ?? 'postgresql') as DbEngine;
        const host = process.env['TARGET_DB_HOST'];
        const user = process.env['TARGET_DB_USER'];
        const database = process.env['TARGET_DB_NAME'];

        if (!host || !user || !database) {
          return errorResponse('No target database configured. Add TARGET_DB_HOST, TARGET_DB_USER, TARGET_DB_NAME to .env and run `argustack sync db`.');
        }

        const { DbProvider } = await import('../../adapters/db/index.js');
        const sourceName = `${engine}:${host}/${database}`;
        const db = new DbProvider({
          engine,
          host,
          port: parseInt(process.env['TARGET_DB_PORT'] ?? '5432', 10),
          user,
          password: process.env['TARGET_DB_PASSWORD'] ?? '',
          database,
          name: sourceName,
        });

        await db.connect();
        try {
          const result = await db.query(sql);

          if (result.rows.length === 0) {
            return textResponse('Query returned 0 rows.');
          }

          const firstRow = result.rows[0];
          if (!firstRow) {
            return textResponse('Query returned 0 rows.');
          }
          const cols = Object.keys(firstRow);
          const header = cols.join(' | ');
          const separator = cols.map((c) => '-'.repeat(c.length)).join(' | ');

          const rows = result.rows.map((row) => {
            return cols.map((c) => str(row[c])).join(' | ');
          });

          const text = [
            `${String(result.rows.length)} rows`,
            '',
            header,
            separator,
            ...rows,
          ].join('\n');

          return textResponse(text);
        } finally {
          await db.disconnect();
        }
      } catch (err: unknown) {
        return errorResponse(`Query failed: ${getErrorMessage(err)}`);
      }
    },
  );

  server.registerTool(
    'db_stats',
    {
      description: 'Get statistics about the external database schema stored in Argustack — total tables, columns, foreign keys, indexes.',
      inputSchema: {
        source: z.string().optional().describe('Filter by source name (if multiple databases synced)'),
      },
    },
    async ({ source }) => {
      const ws = loadWorkspace();
      if (!ws.ok) {
        return errorResponse(`Workspace not found: ${ws.reason}`);
      }

      const { storage } = await createAdapters(ws.root);

      try {
        await storage.initialize();

        const sourceFilter = source ? `WHERE source_name = $1` : '';
        const params = source ? [source] : [];

        const statsResult = await storage.query(
          `SELECT
            (SELECT COUNT(*) FROM db_tables ${sourceFilter}) AS total_tables,
            (SELECT COUNT(*) FROM db_columns ${sourceFilter}) AS total_columns,
            (SELECT COUNT(*) FROM db_foreign_keys ${sourceFilter}) AS total_fks,
            (SELECT COUNT(*) FROM db_indexes ${sourceFilter}) AS total_indexes`,
          params,
        );

        const s = statsResult.rows[0] as unknown as DbStatsRow | undefined;
        if (!s) {
          return textResponse('No database schema data found. Run `argustack sync db` first.');
        }

        const tablesResult = await storage.query(
          `SELECT table_schema, COUNT(*) AS table_count, COALESCE(SUM(row_count), 0) AS total_rows
           FROM db_tables ${sourceFilter}
           GROUP BY table_schema
           ORDER BY table_count DESC`,
          params,
        );

        const largestResult = await storage.query(
          `SELECT table_name, row_count, size_bytes
           FROM db_tables ${sourceFilter}
           ORDER BY COALESCE(row_count, 0) DESC
           LIMIT 10`,
          params,
        );

        const lines: string[] = [
          'Database Schema Statistics',
          '',
          `Tables: ${s.total_tables}`,
          `Columns: ${s.total_columns}`,
          `Foreign keys: ${s.total_fks}`,
          `Indexes: ${s.total_indexes}`,
          '',
          'By schema:',
        ];

        for (const row of tablesResult.rows) {
          const typed = row as unknown as SchemaGroupRow;
          lines.push(`  ${typed.table_schema}: ${typed.table_count} tables, ~${typed.total_rows} rows`);
        }

        if (largestResult.rows.length > 0) {
          lines.push('', 'Largest tables (by row count):');
          for (const row of largestResult.rows) {
            const typed = row as unknown as LargestTableRow;
            const size = typed.size_bytes ? ` (${formatBytes(typed.size_bytes)})` : '';
            lines.push(`  ${typed.table_name}: ~${String(typed.row_count)} rows${size}`);
          }
        }

        return textResponse(lines.join('\n'));
      } catch (err: unknown) {
        return errorResponse(`Failed to get DB stats: ${getErrorMessage(err)}`);
      } finally {
        await storage.close();
      }
    },
  );
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${String(bytes)}B`;
  }
  if (bytes < 1024 * 1024) {
    return `${String(Math.round(bytes / 1024))}KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${String(Math.round(bytes / (1024 * 1024)))}MB`;
  }
  return `${String(Math.round(bytes / (1024 * 1024 * 1024)))}GB`;
}
