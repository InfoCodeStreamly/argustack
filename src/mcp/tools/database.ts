import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v4';
import type { DbSourceConfig } from '../../core/types/index.js';
import {
  loadWorkspace,
  createAdapters,
  textResponse,
  errorResponse,
  getErrorMessage,
  str,
  ANNOTATIONS,
} from '../helpers.js';

const workspaceIdParam = z.string().optional().describe('Workspace id or name (defaults to active workspace)');

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
      title: 'External DB schema',
      description: 'Browse schema metadata for the workspace\'s external databases. Run `argustack sync db` first.',
      inputSchema: {
        workspace_id: workspaceIdParam,
        table: z.string().optional(),
        schema: z.string().optional(),
        source: z.string().optional(),
      },
      annotations: ANNOTATIONS.READ_ONLY,
    },
    async ({ workspace_id: workspaceIdInput, table, schema, source }) => {
      const ws = await loadWorkspace(workspaceIdInput);
      if (!ws.ok) { return errorResponse(ws.reason); }
      const { storage, workspaceId } = await createAdapters(ws.workspaceId);

      try {
        await storage.initialize();

        const conditions: string[] = ['workspace_id = $1'];
        const params: unknown[] = [];
        let paramIdx = 2;
        if (source) { conditions.push(`source_name = $${String(paramIdx)}`); params.push(source); paramIdx++; }
        if (schema) { conditions.push(`table_schema = $${String(paramIdx)}`); params.push(schema); paramIdx++; }
        if (table) { conditions.push(`table_name ILIKE $${String(paramIdx)}`); params.push(`%${table}%`); paramIdx++; }
        const where = `WHERE ${conditions.join(' AND ')}`;

        const tablesResult = await storage.queryForWorkspace(workspaceId,
          `SELECT source_name, table_schema, table_name, row_count, size_bytes
           FROM db_tables ${where} ORDER BY table_schema, table_name LIMIT 200`, params);

        if (tablesResult.rows.length === 0) {
          return textResponse('No tables found. Run `argustack sync db` first.');
        }

        const columnsResult = await storage.queryForWorkspace(workspaceId,
          `SELECT table_name, column_name, data_type, is_nullable, default_value, is_primary_key, ordinal_position
           FROM db_columns ${where} ORDER BY table_name, ordinal_position`, params);

        const fksResult = await storage.queryForWorkspace(workspaceId,
          `SELECT table_name, column_name, referenced_table, referenced_column
           FROM db_foreign_keys ${where} ORDER BY table_name, column_name`, params);

        const indexesResult = await storage.queryForWorkspace(workspaceId,
          `SELECT table_name, index_name, columns, is_unique, is_primary
           FROM db_indexes ${where} ORDER BY table_name, index_name`, params);

        const colsByTable = new Map<string, DbColumnRow[]>();
        for (const row of columnsResult.rows) {
          const col = row as unknown as DbColumnRow;
          const arr = colsByTable.get(col.table_name) ?? [];
          arr.push(col); colsByTable.set(col.table_name, arr);
        }
        const fksByTable = new Map<string, DbFkRow[]>();
        for (const row of fksResult.rows) {
          const fk = row as unknown as DbFkRow;
          const arr = fksByTable.get(fk.table_name) ?? [];
          arr.push(fk); fksByTable.set(fk.table_name, arr);
        }
        const idxByTable = new Map<string, DbIndexRow[]>();
        for (const row of indexesResult.rows) {
          const idx = row as unknown as DbIndexRow;
          const arr = idxByTable.get(idx.table_name) ?? [];
          arr.push(idx); idxByTable.set(idx.table_name, arr);
        }

        const lines: string[] = [`Database Schema (${String(tablesResult.rows.length)} tables) — workspace ${workspaceId}`, ''];
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
      } catch (err) {
        return errorResponse(`Failed to read DB schema: ${getErrorMessage(err)}`);
      }
    },
  );

  server.registerTool(
    'db_query',
    {
      title: 'Query external DB (read-only)',
      description: 'Execute read-only SQL on a workspace\'s APPLICATION database (not Argustack hub). The DB config comes from `workspaces.settings.dbConfigs[0]` (or `source`).',
      inputSchema: {
        workspace_id: workspaceIdParam,
        sql: z.string().describe('SQL query (SELECT/EXPLAIN/SHOW/DESCRIBE only)'),
        source: z.string().optional().describe('DB source name when several are bound to the workspace'),
      },
      annotations: ANNOTATIONS.REMOTE_READ,
    },
    async ({ workspace_id: workspaceIdInput, sql, source }) => {
      const ws = await loadWorkspace(workspaceIdInput);
      if (!ws.ok) { return errorResponse(ws.reason); }
      const bindings = ws.workspace.settings?.dbConfigs ?? [];
      const dbCfg: DbSourceConfig | undefined = source
        ? bindings.find((b) => b.name === source)
        : bindings[0];

      if (!dbCfg) {
        return errorResponse(`No external database configured for workspace "${ws.workspaceId}". Add one with: argustack add db --workspace ${ws.workspaceId} ...`);
      }

      try {
        const { DbProvider } = await import('../../adapters/db/index.js');
        const db = new DbProvider({
          engine: dbCfg.engine,
          host: dbCfg.host,
          port: dbCfg.port,
          user: dbCfg.user,
          password: dbCfg.password,
          database: dbCfg.database,
          name: dbCfg.name,
        });

        await db.connect();
        try {
          const result = await db.query(sql);
          if (result.rows.length === 0) {
            return textResponse('Query returned 0 rows.');
          }
          const firstRow = result.rows[0];
          if (!firstRow) { return textResponse('Query returned 0 rows.'); }
          const cols = Object.keys(firstRow);
          const header = cols.join(' | ');
          const separator = cols.map((c) => '-'.repeat(c.length)).join(' | ');
          const rows = result.rows.map((row) => cols.map((c) => str(row[c])).join(' | '));
          return textResponse([`${String(result.rows.length)} rows`, '', header, separator, ...rows].join('\n'));
        } finally {
          await db.disconnect();
        }
      } catch (err) {
        return errorResponse(`Query failed: ${getErrorMessage(err)}`);
      }
    },
  );

  server.registerTool(
    'db_stats',
    {
      title: 'External DB statistics',
      description: 'Statistics about external DB schema cached for a workspace.',
      inputSchema: {
        workspace_id: workspaceIdParam,
        source: z.string().optional(),
      },
      annotations: ANNOTATIONS.READ_ONLY,
    },
    async ({ workspace_id: workspaceIdInput, source }) => {
      const ws = await loadWorkspace(workspaceIdInput);
      if (!ws.ok) { return errorResponse(ws.reason); }
      const { storage, workspaceId } = await createAdapters(ws.workspaceId);

      try {
        await storage.initialize();
        const conditions = ['workspace_id = $1'];
        const params: unknown[] = [];
        if (source) { conditions.push('source_name = $2'); params.push(source); }
        const where = `WHERE ${conditions.join(' AND ')}`;

        const statsResult = await storage.queryForWorkspace(workspaceId,
          `SELECT
            (SELECT COUNT(*) FROM db_tables ${where}) AS total_tables,
            (SELECT COUNT(*) FROM db_columns ${where}) AS total_columns,
            (SELECT COUNT(*) FROM db_foreign_keys ${where}) AS total_fks,
            (SELECT COUNT(*) FROM db_indexes ${where}) AS total_indexes`,
          params);

        const s = statsResult.rows[0] as unknown as DbStatsRow | undefined;
        if (!s) {
          return textResponse('No database schema data found.');
        }

        const tablesResult = await storage.queryForWorkspace(workspaceId,
          `SELECT table_schema, COUNT(*) AS table_count, COALESCE(SUM(row_count), 0) AS total_rows
           FROM db_tables ${where} GROUP BY table_schema ORDER BY table_count DESC`, params);

        const largestResult = await storage.queryForWorkspace(workspaceId,
          `SELECT table_name, row_count, size_bytes
           FROM db_tables ${where} ORDER BY COALESCE(row_count, 0) DESC LIMIT 10`, params);

        const lines: string[] = [
          `Database Schema Statistics — workspace ${workspaceId}`,
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
      } catch (err) {
        return errorResponse(`Failed to get DB stats: ${getErrorMessage(err)}`);
      }
    },
  );
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) { return `${String(bytes)}B`; }
  if (bytes < 1024 * 1024) { return `${String(Math.round(bytes / 1024))}KB`; }
  if (bytes < 1024 * 1024 * 1024) { return `${String(Math.round(bytes / (1024 * 1024)))}MB`; }
  return `${String(Math.round(bytes / (1024 * 1024 * 1024)))}GB`;
}
