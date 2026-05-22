import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type pg from 'pg';
import type { IWorkspaceStore } from '../core/ports/workspace-store.js';
import {
  copyTable,
  copyGraphEntities,
  countTable,
  verifyCounts,
  discoverLegacyDbConfig,
  type CountMismatch,
} from '../adapters/postgres/migrate-helpers.js';
import { createPool } from '../adapters/postgres/connection.js';

function noop(_message: string): void { /* intentional */ }

export interface LegacyWorkspaceInfo {
  readonly id: string;
  readonly name: string;
  readonly path: string;
}

export interface MigrateOptions {
  readonly dryRun?: boolean;
  readonly allowConflicts?: boolean;
  readonly keepLegacy?: boolean;
  readonly rename?: Readonly<Record<string, string>>;
  readonly onProgress?: (message: string) => void;
}

export interface MigrateResult {
  readonly migrated: readonly string[];
  readonly skipped: readonly string[];
  readonly mismatches: readonly { workspaceId: string; mismatches: readonly CountMismatch[] }[];
}

const TENANT_TABLES_TO_COPY = [
  { table: 'issue_comments', columns: ['issue_key', 'comment_id', 'author', 'body', 'created', 'updated'] },
  { table: 'issue_changelogs', columns: ['issue_key', 'author', 'field', 'from_value', 'to_value', 'changed_at'] },
  { table: 'issue_worklogs', columns: ['issue_key', 'author', 'time_spent', 'time_spent_seconds', 'comment', 'started'] },
  { table: 'issue_links', columns: ['source_key', 'target_key', 'link_type', 'direction'] },
  { table: 'commit_files', columns: ['commit_hash', 'file_path', 'status', 'additions', 'deletions'] },
  { table: 'commit_issue_refs', columns: ['commit_hash', 'issue_key'] },
  { table: 'pr_reviews', columns: ['pr_number', 'repo_full_name', 'review_id', 'reviewer', 'state', 'body', 'submitted_at'] },
  { table: 'pr_comments', columns: ['pr_number', 'repo_full_name', 'comment_id', 'author', 'body', 'path', 'line', 'created_at', 'updated_at'] },
  { table: 'pr_files', columns: ['pr_number', 'repo_full_name', 'file_path', 'status', 'additions', 'deletions'] },
  { table: 'pr_issue_refs', columns: ['pr_number', 'repo_full_name', 'issue_key'] },
  { table: 'db_tables', columns: ['source_name', 'table_schema', 'table_name', 'row_count', 'size_bytes'] },
  { table: 'db_columns', columns: ['source_name', 'table_schema', 'table_name', 'column_name', 'data_type', 'is_nullable', 'default_value', 'is_primary_key', 'ordinal_position'] },
  { table: 'db_foreign_keys', columns: ['source_name', 'table_name', 'column_name', 'referenced_table', 'referenced_column'] },
  { table: 'db_indexes', columns: ['source_name', 'table_name', 'index_name', 'columns', 'is_unique', 'is_primary'] },
] as const;

const VERIFY_TABLES = [
  'issues', 'issue_comments', 'issue_changelogs', 'issue_worklogs', 'issue_links',
  'commits', 'commit_files', 'commit_issue_refs',
  'pull_requests', 'pr_reviews', 'pr_comments', 'pr_files', 'pr_issue_refs',
  'releases',
  'graph_entities', 'graph_relationships', 'graph_observations',
  'db_tables', 'db_columns', 'db_foreign_keys', 'db_indexes',
] as const;

/**
 * Use Case: migrate legacy per-workspace Postgres stacks into the hub.
 *
 * For each legacy workspace:
 *   1. Discover its DB port from `<root>/.env`
 *   2. Connect to legacy pg as a read-only source
 *   3. Insert/upsert into `workspaces` (apply --rename if requested)
 *   4. Copy `issues` and `releases` (composite tables that lead with workspace_id)
 *   5. Copy `commits` and `pull_requests` (PKs change, but composite FKs work)
 *   6. Rebuild `graph_entities` with new SERIAL ids and remap relationships
 *   7. Copy all child tables via `copyTable`
 *   8. Verify row counts
 *   9. Write a `.hub-migrated` marker so legacy CLI invocations can detect it
 */
export class MigrateToHubUseCase {
  constructor(
    private readonly hubPool: pg.Pool,
    private readonly hubStore: IWorkspaceStore,
  ) {}

  async execute(
    legacy: readonly LegacyWorkspaceInfo[],
    options: MigrateOptions = {},
  ): Promise<MigrateResult> {
    const log = options.onProgress ?? noop;
    const migrated: string[] = [];
    const skipped: string[] = [];
    const allMismatches: { workspaceId: string; mismatches: CountMismatch[] }[] = [];

    for (const entry of legacy) {
      const workspaceId = options.rename?.[entry.id] ?? entry.id;
      log(`\n=== ${entry.name} (${entry.path})`);
      log(`  → hub workspace_id="${workspaceId}"`);

      const legacyDb = discoverLegacyDbConfig(entry.path);
      log(`  legacy db: ${legacyDb.host}:${String(legacyDb.port)}/${legacyDb.database}`);

      const srcPool = createPool(legacyDb);
      try {
        const legacyIssues = await countTable(srcPool, 'issues').catch(() => 0);
        const legacyCommits = await countTable(srcPool, 'commits').catch(() => 0);
        const legacyPrs = await countTable(srcPool, 'pull_requests').catch(() => 0);
        log(`  legacy: ${String(legacyIssues)} issues, ${String(legacyCommits)} commits, ${String(legacyPrs)} PRs`);

        if (options.dryRun === true) {
          log('  [dry-run] skipping write');
          continue;
        }

        await this.hubStore.create({ id: workspaceId, name: workspaceId });
        await this.copyIssues(srcPool, workspaceId);
        await this.copyCommits(srcPool, workspaceId);
        await this.copyPullRequests(srcPool, workspaceId);
        await this.copyReleases(srcPool, workspaceId);

        const idRemap = await copyGraphEntities(srcPool, this.hubPool, workspaceId);
        log(`  remapped ${String(idRemap.size)} graph_entities`);
        await this.copyGraphRelationships(srcPool, workspaceId, idRemap);
        await this.copyGraphObservations(srcPool, workspaceId, idRemap);

        for (const { table, columns } of TENANT_TABLES_TO_COPY) {
          const copied = await copyTable(srcPool, this.hubPool, workspaceId, table, columns).catch(() => 0);
          log(`  ${table}: ${String(copied)} rows`);
        }

        const mismatches = await verifyCounts(srcPool, this.hubPool, workspaceId, VERIFY_TABLES);
        if (mismatches.length > 0) {
          allMismatches.push({ workspaceId, mismatches });
          log(`  ⚠ count mismatches: ${mismatches.map((m) => `${m.table}(${String(m.legacy)} vs ${String(m.hub)})`).join(', ')}`);
        }

        if (options.keepLegacy !== true) {
          this.writeMarker(entry.path, workspaceId);
        }

        migrated.push(workspaceId);
        log(`  ✓ migrated → ${workspaceId}`);
      } catch (err) {
        skipped.push(workspaceId);
        log(`  ✗ ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        await srcPool.end();
      }
    }

    return { migrated, skipped, mismatches: allMismatches };
  }

  private async copyIssues(src: pg.Pool, workspaceId: string): Promise<void> {
    const cols = [
      'issue_key', 'issue_id', 'project_key', 'summary', 'description',
      'issue_type', 'status', 'status_category', 'priority', 'resolution',
      'assignee', 'assignee_id', 'reporter', 'reporter_id', 'created', 'updated', 'resolved',
      'due_date', 'labels', 'components', 'fix_versions', 'parent_key',
      'sprint', 'story_points', 'original_estimate', 'remaining_estimate', 'time_spent',
      'custom_fields', 'raw_json', 'source',
    ];
    await copyTable(src, this.hubPool, workspaceId, 'issues', cols);
  }

  private async copyCommits(src: pg.Pool, workspaceId: string): Promise<void> {
    const cols = ['hash', 'message', 'author', 'email', 'committed_at', 'parents', 'repo_path'];
    await copyTable(src, this.hubPool, workspaceId, 'commits', cols);
  }

  private async copyPullRequests(src: pg.Pool, workspaceId: string): Promise<void> {
    const cols = [
      'number', 'repo_full_name', 'title', 'body', 'state', 'author',
      'created_at', 'updated_at', 'merged_at', 'closed_at',
      'merge_commit_sha', 'head_ref', 'base_ref',
      'labels', 'reviewers', 'additions', 'deletions', 'changed_files',
      'raw_json',
    ];
    await copyTable(src, this.hubPool, workspaceId, 'pull_requests', cols);
  }

  private async copyReleases(src: pg.Pool, workspaceId: string): Promise<void> {
    const cols = [
      'id', 'repo_full_name', 'tag_name', 'name', 'body', 'author',
      'draft', 'prerelease', 'created_at', 'published_at', 'raw_json',
    ];
    await copyTable(src, this.hubPool, workspaceId, 'releases', cols);
  }

  private async copyGraphRelationships(
    src: pg.Pool,
    workspaceId: string,
    idRemap: Map<number, number>,
  ): Promise<void> {
    const result = await src.query<{
      source_id: number;
      target_id: number;
      type: string;
      weight: string;
      source: string;
      properties: Record<string, unknown> | null;
    }>(`SELECT source_id, target_id, type, weight, source, properties FROM graph_relationships`);

    for (const row of result.rows) {
      const newSrc = idRemap.get(row.source_id);
      const newTgt = idRemap.get(row.target_id);
      if (newSrc === undefined || newTgt === undefined) {
        continue;
      }
      await this.hubPool.query(
        `INSERT INTO graph_relationships (workspace_id, source_id, target_id, type, weight, source, properties)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
         ON CONFLICT DO NOTHING`,
        [workspaceId, newSrc, newTgt, row.type, row.weight, row.source, JSON.stringify(row.properties ?? {})],
      );
    }
  }

  private async copyGraphObservations(
    src: pg.Pool,
    workspaceId: string,
    idRemap: Map<number, number>,
  ): Promise<void> {
    const result = await src.query<{
      entity_id: number;
      content: string;
      author: string;
      created_at: Date;
    }>(`SELECT entity_id, content, author, created_at FROM graph_observations`);

    for (const row of result.rows) {
      const newEntity = idRemap.get(row.entity_id);
      if (newEntity === undefined) {
        continue;
      }
      await this.hubPool.query(
        `INSERT INTO graph_observations (workspace_id, entity_id, content, author, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [workspaceId, newEntity, row.content, row.author, row.created_at],
      );
    }
  }

  private writeMarker(legacyRoot: string, workspaceId: string): void {
    const dir = join(legacyRoot, '.argustack');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const markerPath = join(dir, '.hub-migrated');
    writeFileSync(
      markerPath,
      `${JSON.stringify({ workspaceId, migratedAt: new Date().toISOString() }, null, 2)  }\n`,
    );
  }
}
