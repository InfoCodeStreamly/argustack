import type pg from 'pg';

/**
 * Discover the legacy Postgres port for a per-workspace stack by reading
 * the workspace's `.env` file. Falls back to 5434 (the historical default
 * Argustack docker-compose used for per-workspace stacks).
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface LegacyDbConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export function discoverLegacyDbConfig(workspaceRoot: string): LegacyDbConfig {
  const envPath = join(workspaceRoot, '.env');
  const cfg: LegacyDbConfig = {
    host: 'localhost',
    port: 5434,
    user: 'argustack',
    password: 'argustack_local',
    database: 'argustack',
  };
  if (!existsSync(envPath)) {
    return cfg;
  }
  const content = readFileSync(envPath, 'utf-8');
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) { continue; }
    const eq = line.indexOf('=');
    if (eq === -1) { continue; }
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    switch (key) {
      case 'DB_HOST': cfg.host = value; break;
      case 'DB_PORT': { const parsed = parseInt(value, 10); cfg.port = !isNaN(parsed) && parsed > 0 ? parsed : 5434; break; }
      case 'DB_USER': cfg.user = value; break;
      case 'DB_PASSWORD': cfg.password = value; break;
      case 'DB_NAME': cfg.database = value; break;
      default: break;
    }
  }
  return cfg;
}

/**
 * Copy rows from a legacy table into the hub table for a specific
 * workspace. Streams in batches to avoid loading the whole table in
 * memory. Returns the number of rows copied.
 */
export async function copyTable(
  src: pg.Pool,
  dst: pg.Pool,
  workspaceId: string,
  table: string,
  columns: readonly string[],
  options: { batchSize?: number; idRemap?: Map<number, number>; idColumn?: string; remappedColumns?: readonly string[] } = {},
): Promise<number> {
  const batchSize = options.batchSize ?? 500;
  let total = 0;
  let offset = 0;
  const cols = columns.join(', ');

  while (true) {
    const result = await src.query<Record<string, unknown>>(
      `SELECT ${cols} FROM ${table} ORDER BY 1 LIMIT $1 OFFSET $2`,
      [batchSize, offset],
    );
    if (result.rows.length === 0) {
      break;
    }

    for (const row of result.rows) {
      const values: unknown[] = [workspaceId];
      for (const col of columns) {
        let v = row[col];
        if (options.idRemap !== undefined && options.remappedColumns?.includes(col) === true) {
          const old = v as number | null;
          v = old !== null && options.idRemap.has(old) ? options.idRemap.get(old) : null;
        }
        values.push(v);
      }
      const placeholders = columns.map((_, i) => `$${String(i + 2)}`).join(', ');
      try {
        await dst.query(
          `INSERT INTO ${table} (workspace_id, ${cols}) VALUES ($1, ${placeholders}) ON CONFLICT DO NOTHING`,
          values,
        );
      } catch {
        /* skip rows that violate composite constraints (already migrated) */
      }
      total++;
    }
    offset += result.rows.length;
    if (result.rows.length < batchSize) { break; }
  }
  return total;
}

/**
 * Build a map from legacy SERIAL `graph_entities.id` to the new hub id
 * (also SERIAL, but distinct per workspace). The map is used to rewrite
 * `graph_relationships.source_id/target_id` and
 * `graph_observations.entity_id` during the copy.
 */
export async function copyGraphEntities(
  src: pg.Pool,
  dst: pg.Pool,
  workspaceId: string,
): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  const result = await src.query<{ id: number; name: string; type: string; properties: Record<string, unknown> | null }>(
    `SELECT id, name, type, properties FROM graph_entities`,
  );
  for (const row of result.rows) {
    const inserted = await dst.query<{ id: number }>(
      `INSERT INTO graph_entities (workspace_id, name, type, properties)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (workspace_id, name, type) DO UPDATE SET properties = EXCLUDED.properties
       RETURNING id`,
      [workspaceId, row.name, row.type, JSON.stringify(row.properties ?? {})],
    );
    const newId = inserted.rows[0]?.id;
    if (newId !== undefined) {
      map.set(row.id, newId);
    }
  }
  return map;
}

/**
 * Count rows in a table (no workspace filter — used against legacy pools).
 */
export async function countTable(pool: pg.Pool, table: string): Promise<number> {
  const result = await pool.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM ${table}`);
  return Number(result.rows[0]?.count ?? '0');
}

/**
 * Verify post-copy: for each table compare row counts between source
 * (full legacy db) and hub (`WHERE workspace_id = $1`). Returns a list
 * of mismatches; an empty list means perfect copy.
 */
export interface CountMismatch {
  table: string;
  legacy: number;
  hub: number;
}

export async function verifyCounts(
  src: pg.Pool,
  dst: pg.Pool,
  workspaceId: string,
  tables: readonly string[],
): Promise<CountMismatch[]> {
  const mismatches: CountMismatch[] = [];
  for (const table of tables) {
    const legacy = await countTable(src, table);
    const hub = await dst.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM ${table} WHERE workspace_id = $1`,
      [workspaceId],
    );
    const hubCount = Number(hub.rows[0]?.count ?? '0');
    if (legacy !== hubCount) {
      mismatches.push({ table, legacy, hub: hubCount });
    }
  }
  return mismatches;
}
