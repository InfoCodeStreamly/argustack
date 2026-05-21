import type { Workspace, WorkspaceSettings } from '../types/workspace.js';

/**
 * Port: WorkspaceStore — SSOT for tenant identity in the hub model.
 *
 * Implementations live alongside other adapters of the same backing store
 * (e.g. {@link PostgresWorkspaceStore}). The store owns the `workspaces`
 * table and is the only writer of `last_active_at`.
 *
 * Lifecycle:
 *   1. `initialize()` is called once at process startup (creates the
 *      `workspaces` table if missing — idempotent).
 *   2. All other methods operate on existing connections.
 *   3. `close()` releases the connection pool.
 *
 * Errors:
 *   - `create()` throws if `id` is empty, contains characters outside
 *     `[a-z0-9-]`, or collides with an existing row by name when
 *     `id` differs.
 *   - `remove()` triggers ON DELETE CASCADE across 24 tenant tables.
 *     Callers must clean external stores (Neo4j project node, Qdrant
 *     collection) separately — the store does not cross adapter
 *     boundaries.
 */
export interface IWorkspaceStore {
  readonly name: string;

  initialize(): Promise<void>;

  /**
   * Create a workspace row. Idempotent: re-creating an existing `id`
   * updates the mutable fields (name, displayName, settings) and
   * preserves `createdAt` and `lastActiveAt`.
   */
  create(workspace: Workspace): Promise<Workspace>;

  getById(id: string): Promise<Workspace | null>;

  getByName(name: string): Promise<Workspace | null>;

  /** Returned ordered by `last_active_at DESC, created_at DESC`. */
  list(): Promise<Workspace[]>;

  /**
   * Merge the patch into `settings` JSONB. Top-level keys are
   * replaced; arrays inside `settings` are replaced, not concatenated.
   */
  updateSettings(id: string, patch: Partial<WorkspaceSettings>): Promise<void>;

  /**
   * Remove a workspace. CASCADE deletes data from all 24 tenant
   * tables in a single transaction. Does not touch Neo4j/Qdrant —
   * callers must clean those stores separately.
   */
  remove(id: string): Promise<void>;

  /** Update `last_active_at = NOW()` for `id`. No-op if `id` is unknown. */
  touchActive(id: string): Promise<void>;

  close(): Promise<void>;
}
