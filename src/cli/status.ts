import type { Command } from 'commander';
import chalk from 'chalk';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ALL_SOURCES, SOURCE_META } from '../core/types/index.js';
import type { Workspace } from '../core/types/index.js';
import { loadHubConfig, hubDir } from '../workspace/hub-config.js';
import { getActiveWorkspaceId } from '../workspace/active-workspace.js';
import { openHubStore } from './workspace/shared.js';

interface Options {
  workspace?: string;
}

interface CountRow {
  cnt: string;
}

function sourceEnabled(workspace: Workspace, source: string): boolean {
  const s = workspace.settings ?? {};
  switch (source) {
    case 'jira': return (s.jiraProjectKeys?.length ?? 0) > 0;
    case 'git': return (s.gitRepoPaths?.length ?? 0) > 0;
    case 'github': return (s.githubRepos?.length ?? 0) > 0;
    case 'csv': return (s.csvFilePaths?.length ?? 0) > 0;
    case 'db': return (s.dbConfigs?.length ?? 0) > 0;
    default: return false;
  }
}

function containerRunning(name: string): boolean {
  try {
    const out = execSync(`docker ps --filter "name=^/${name}$" --format "{{.Names}}"`, { encoding: 'utf-8' });
    return out.trim() === name;
  } catch {
    return false;
  }
}

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Hub overview + workspace stats')
    .option('--workspace <name>', 'Show stats for a specific workspace (defaults to active)')
    .action(async (options: Options) => {
      const hub = loadHubConfig();
      const composePath = join(hubDir(), 'docker-compose.yml');

      console.log('');
      console.log(chalk.bold('  Argustack Hub'));
      console.log(chalk.dim(`  ${hubDir()}`));
      console.log('');

      const pg = containerRunning('argustack-hub-pg');
      const neo4j = containerRunning('argustack-hub-neo4j');
      const qdrant = containerRunning('argustack-hub-qdrant');
      const pgweb = containerRunning('argustack-hub-pgweb');
      const composeReady = existsSync(composePath);

      console.log(chalk.bold('  Containers:'));
      console.log(`    ${pg ? chalk.green('✓') : chalk.red('✗')} pg`);
      console.log(`    ${pgweb ? chalk.green('✓') : chalk.red('✗')} pgweb`);
      console.log(`    ${neo4j ? chalk.green('✓') : chalk.red('✗')} neo4j`);
      console.log(`    ${qdrant ? chalk.green('✓') : chalk.red('✗')} qdrant`);
      if (!composeReady) {
        console.log(chalk.dim(`  (no compose file at ${composePath} — run "argustack init")`));
      }
      console.log('');

      const { store, close } = await openHubStore();
      try {
        const all = await store.list();
        if (all.length === 0) {
          console.log(chalk.yellow('  No workspaces registered.'));
          console.log(chalk.dim('  Run: argustack workspace add <name>'));
          return;
        }

        const activeId = getActiveWorkspaceId();
        const targetId = options.workspace !== undefined && options.workspace !== ''
          ? ((await store.getById(options.workspace)) ?? (await store.getByName(options.workspace)))?.id
          : activeId;

        if (targetId !== undefined && targetId !== null && targetId !== '') {
          const workspace = await store.getById(targetId);
          if (workspace == null) {
            console.log(chalk.yellow(`  Workspace "${targetId}" not found.`));
            return;
          }
          const { createPool } = await import('../adapters/postgres/index.js');
          const pool = createPool(hub.db);
          try {
            console.log(chalk.bold(`  Workspace: ${workspace.name}  ${chalk.dim(`[${workspace.id}]`)}${workspace.id === activeId ? chalk.green(' (active)') : ''}`));
            console.log('');
            console.log(chalk.bold('  Sources:'));
            for (const source of ALL_SOURCES) {
              const meta = SOURCE_META[source];
              if (sourceEnabled(workspace, source)) {
                console.log(`    ${chalk.green('✓')} ${meta.label}`);
              } else {
                console.log(`    ${chalk.dim('○')} ${chalk.dim(meta.label)}`);
              }
            }

            const issuesRes = await pool.query<CountRow>(
              `SELECT COUNT(*)::text AS cnt FROM issues WHERE workspace_id = $1`,
              [workspace.id],
            );
            const commitsRes = await pool.query<CountRow>(
              `SELECT COUNT(*)::text AS cnt FROM commits WHERE workspace_id = $1`,
              [workspace.id],
            );
            const prsRes = await pool.query<CountRow>(
              `SELECT COUNT(*)::text AS cnt FROM pull_requests WHERE workspace_id = $1`,
              [workspace.id],
            );
            console.log('');
            console.log(chalk.bold('  Data:'));
            console.log(`    issues:   ${issuesRes.rows[0]?.cnt ?? '0'}`);
            console.log(`    commits:  ${commitsRes.rows[0]?.cnt ?? '0'}`);
            console.log(`    PRs:      ${prsRes.rows[0]?.cnt ?? '0'}`);
            console.log('');
          } finally {
            await pool.end();
          }
        }

        console.log(chalk.bold('  All workspaces:'));
        for (const w of all) {
          const marker = w.id === activeId ? chalk.green('●') : chalk.dim('○');
          const suffix = w.id === activeId ? chalk.dim(' (active)') : '';
          console.log(`    ${marker} ${w.name}${suffix}`);
        }
        console.log('');
      } finally {
        await close();
      }
    });
}
