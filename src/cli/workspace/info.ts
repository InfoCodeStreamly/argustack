import type { Command } from 'commander';
import chalk from 'chalk';
import { getActiveWorkspaceId } from '../../workspace/active-workspace.js';
import { openHubStore } from './shared.js';

interface CountRow {
  cnt: string;
}

const COUNT_TABLES: readonly string[] = [
  'issues',
  'issue_comments',
  'commits',
  'commit_files',
  'pull_requests',
  'pr_reviews',
  'releases',
  'graph_entities',
  'graph_relationships',
  'graph_observations',
  'db_tables',
  'code_projects',
  'code_files',
];

export function registerInfoCommand(group: Command): void {
  group
    .command('info [name]')
    .description('Show row counts per source for a workspace (defaults to active)')
    .action(async (name: string | undefined) => {
      const { store, close } = await openHubStore();
      try {
        const id = name ?? getActiveWorkspaceId();
        if (!id) {
          throw new Error('No active workspace. Pass a name or run "argustack workspace use <name>".');
        }
        const workspace = (await store.getById(id)) ?? (await store.getByName(id));
        if (!workspace) {
          throw new Error(`Workspace "${id}" not found.`);
        }

        const { loadHubConfig } = await import('../../workspace/hub-config.js');
        const { createPool } = await import('../../adapters/postgres/index.js');
        const pool = createPool(loadHubConfig().db);
        try {
          console.log(chalk.bold(`\n  Workspace: ${workspace.name}  ${chalk.dim(`[${workspace.id}]`)}`));
          if (workspace.lastActiveAt) {
            console.log(chalk.dim(`  last active: ${workspace.lastActiveAt}`));
          }
          console.log('');

          for (const table of COUNT_TABLES) {
            const result = await pool.query<CountRow>(
              `SELECT COUNT(*)::text AS cnt FROM ${table} WHERE workspace_id = $1`,
              [workspace.id],
            );
            const cnt = Number(result.rows[0]?.cnt ?? '0');
            console.log(`    ${chalk.cyan(table.padEnd(22))} ${cnt}`);
          }

          const settings = workspace.settings ?? {};
          console.log('');
          console.log(chalk.bold('  Settings:'));
          console.log(`    jira projects:   ${(settings.jiraProjectKeys ?? []).join(', ') || chalk.dim('(none)')}`);
          console.log(`    git repos:       ${(settings.gitRepoPaths ?? []).join(', ') || chalk.dim('(none)')}`);
          const githubBindings = (settings.githubRepos ?? []).map((r) => `${r.owner}/${r.repo}`);
          console.log(`    github repos:    ${githubBindings.join(', ') || chalk.dim('(none)')}`);
          console.log('');
        } finally {
          await pool.end();
        }
      } finally {
        await close();
      }
    });
}
