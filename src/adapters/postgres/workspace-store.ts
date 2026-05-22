import type pg from 'pg';
import type { IWorkspaceStore } from '../../core/ports/workspace-store.js';
import type { Workspace, WorkspaceSettings } from '../../core/types/workspace.js';
import { ensureSchema } from './schema.js';

interface WorkspaceRow {
  id: string;
  name: string;
  display_name: string | null;
  settings: WorkspaceSettings;
  created_at: Date | null;
  last_active_at: Date | null;
}

function rowToWorkspace(row: WorkspaceRow): Workspace {
  const workspace: {
    -readonly [K in keyof Workspace]: Workspace[K];
  } = {
    id: row.id,
    name: row.name,
    settings: row.settings,
  };
  if (row.display_name !== null) {
    workspace.displayName = row.display_name;
  }
  if (row.created_at !== null) {
    workspace.createdAt = row.created_at.toISOString();
  }
  if (row.last_active_at !== null) {
    workspace.lastActiveAt = row.last_active_at.toISOString();
  }
  return workspace;
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

function assertSlug(id: string): void {
  if (!SLUG_RE.test(id)) {
    throw new Error(
      `Workspace id must match ${SLUG_RE} (lowercase kebab-case, 1-64 chars). Got: "${id}"`,
    );
  }
}

/**
 * Postgres-backed implementation of {@link IWorkspaceStore}.
 *
 * Owns the `workspaces` table. All other adapters consume tenant identity
 * through workspaceId parameters and reference workspaces(id) via foreign
 * keys with `ON DELETE CASCADE` — so `remove()` is a single DELETE that
 * fans out to 24 tenant tables.
 */
export class PostgresWorkspaceStore implements IWorkspaceStore {
  readonly name = 'PostgreSQL';

  constructor(private readonly pool: pg.Pool) {}

  async initialize(): Promise<void> {
    await ensureSchema(this.pool);
  }

  async create(workspace: Workspace): Promise<Workspace> {
    assertSlug(workspace.id);
    if (workspace.name === '' || workspace.name.trim().length === 0) {
      throw new Error('Workspace name is required');
    }

    const settings = workspace.settings ?? {};

    const result = await this.pool.query<WorkspaceRow>(
      `
      INSERT INTO workspaces (id, name, display_name, settings)
      VALUES ($1, $2, $3, $4::jsonb)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        display_name = EXCLUDED.display_name,
        settings = EXCLUDED.settings
      RETURNING id, name, display_name, settings, created_at, last_active_at
      `,
      [workspace.id, workspace.name, workspace.displayName ?? null, JSON.stringify(settings)],
    );

    const row = result.rows[0];
    if (row === undefined) {
      throw new Error(`Failed to create workspace "${workspace.id}"`);
    }
    return rowToWorkspace(row);
  }

  async getById(id: string): Promise<Workspace | null> {
    const result = await this.pool.query<WorkspaceRow>(
      `SELECT id, name, display_name, settings, created_at, last_active_at
       FROM workspaces WHERE id = $1`,
      [id],
    );
    return result.rows[0] !== undefined ? rowToWorkspace(result.rows[0]) : null;
  }

  async getByName(name: string): Promise<Workspace | null> {
    const result = await this.pool.query<WorkspaceRow>(
      `SELECT id, name, display_name, settings, created_at, last_active_at
       FROM workspaces WHERE name = $1`,
      [name],
    );
    return result.rows[0] !== undefined ? rowToWorkspace(result.rows[0]) : null;
  }

  async list(): Promise<Workspace[]> {
    const result = await this.pool.query<WorkspaceRow>(
      `SELECT id, name, display_name, settings, created_at, last_active_at
       FROM workspaces
       ORDER BY last_active_at DESC NULLS LAST, created_at DESC NULLS LAST`,
    );
    return result.rows.map(rowToWorkspace);
  }

  async updateSettings(id: string, patch: Partial<WorkspaceSettings>): Promise<void> {
    await this.pool.query(
      `UPDATE workspaces
       SET settings = COALESCE(settings, '{}'::jsonb) || $2::jsonb
       WHERE id = $1`,
      [id, JSON.stringify(patch)],
    );
  }

  async remove(id: string): Promise<void> {
    await this.pool.query(`DELETE FROM workspaces WHERE id = $1`, [id]);
  }

  async touchActive(id: string): Promise<void> {
    await this.pool.query(`UPDATE workspaces SET last_active_at = NOW() WHERE id = $1`, [id]);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
