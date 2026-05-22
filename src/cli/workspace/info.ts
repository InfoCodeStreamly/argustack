import type { Command } from 'commander';
import chalk from 'chalk';
import { getActiveWorkspaceId } from '../../workspace/active-workspace.js';
import { openHubStore } from './shared.js';

interface CountRow {
  cnt: string;
}

/**
 * SQL count query per tenant table. Most tables expose a direct
 * `workspace_id` column; `code_files` and `code_index_jobs` use
 * `project_id` (FK to `code_projects.id`), so their workspace scoping
 * is expressed via a sub-select.
 */
interface CountSpec {
  readonly table: string;
  readonly sql: string;
}

const COUNT_TABLES: readonly CountSpec[] = [
  { table: 'issues', sql: 'SELECT COUNT(*)::text AS cnt FROM issues WHERE workspace_id = $1' },
  { table: 'issue_comments', sql: 'SELECT COUNT(*)::text AS cnt FROM issue_comments WHERE workspace_id = $1' },
  { table: 'commits', sql: 'SELECT COUNT(*)::text AS cnt FROM commits WHERE workspace_id = $1' },
  { table: 'commit_files', sql: 'SELECT COUNT(*)::text AS cnt FROM commit_files WHERE workspace_id = $1' },
  { table: 'pull_requests', sql: 'SELECT COUNT(*)::text AS cnt FROM pull_requests WHERE workspace_id = $1' },
  { table: 'pr_reviews', sql: 'SELECT COUNT(*)::text AS cnt FROM pr_reviews WHERE workspace_id = $1' },
  { table: 'releases', sql: 'SELECT COUNT(*)::text AS cnt FROM releases WHERE workspace_id = $1' },
  { table: 'graph_entities', sql: 'SELECT COUNT(*)::text AS cnt FROM graph_entities WHERE workspace_id = $1' },
  { table: 'graph_relationships', sql: 'SELECT COUNT(*)::text AS cnt FROM graph_relationships WHERE workspace_id = $1' },
  { table: 'graph_observations', sql: 'SELECT COUNT(*)::text AS cnt FROM graph_observations WHERE workspace_id = $1' },
  { table: 'db_tables', sql: 'SELECT COUNT(*)::text AS cnt FROM db_tables WHERE workspace_id = $1' },
  { table: 'code_projects', sql: 'SELECT COUNT(*)::text AS cnt FROM code_projects WHERE workspace_id = $1' },
  { table: 'code_files', sql: 'SELECT COUNT(*)::text AS cnt FROM code_files WHERE project_id IN (SELECT id FROM code_projects WHERE workspace_id = $1)' },
];

export function registerInfoCommand(group: Command): void {
  group
    .command('info [name]')
    .description('Show row counts per source for a workspace (defaults to active)')
    .action(async (name: string | undefined) => {
      const { store, close } = await openHubStore();
      try {
        const id = name ?? getActiveWorkspaceId();
        if (id === null || id === '') {
          throw new Error('No active workspace. Pass a name or run "argustack workspace use <name>".');
        }
        const workspace = (await store.getById(id)) ?? (await store.getByName(id));
        if (workspace == null) {
          throw new Error(`Workspace "${id}" not found.`);
        }

        const { loadHubConfig } = await import('../../workspace/hub-config.js');
        const { createPool } = await import('../../adapters/postgres/index.js');
        const pool = createPool(loadHubConfig().db);
        try {
          console.log(chalk.bold(`\n  Workspace: ${workspace.name}  ${chalk.dim(`[${workspace.id}]`)}`));
          if (workspace.lastActiveAt !== undefined && workspace.lastActiveAt !== '') {
            console.log(chalk.dim(`  last active: ${workspace.lastActiveAt}`));
          }
          console.log('');

          for (const spec of COUNT_TABLES) {
            const result = await pool.query<CountRow>(spec.sql, [workspace.id]);
            const cnt = Number(result.rows[0]?.cnt ?? '0');
            console.log(`    ${chalk.cyan(spec.table.padEnd(22))} ${cnt}`);
          }

          const settings = workspace.settings ?? {};
          console.log('');
          console.log(chalk.bold('  Settings:'));
          const jiraList = (settings.jiraProjectKeys ?? []).join(', ');
          console.log(`    jira projects:   ${jiraList !== '' ? jiraList : chalk.dim('(none)')}`);
          const gitList = (settings.gitRepoPaths ?? []).join(', ');
          console.log(`    git repos:       ${gitList !== '' ? gitList : chalk.dim('(none)')}`);
          const githubBindings = (settings.githubRepos ?? []).map((r) => `${r.owner}/${r.repo}`);
          const githubList = githubBindings.join(', ');
          console.log(`    github repos:    ${githubList !== '' ? githubList : chalk.dim('(none)')}`);
          console.log('');
        } finally {
          await pool.end();
        }
      } finally {
        await close();
      }
    });
}
