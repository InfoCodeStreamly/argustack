import type { Command } from 'commander';
import chalk from 'chalk';
import type { Workspace } from '../core/types/index.js';
import { SOURCE_META, ALL_SOURCES } from '../core/types/index.js';
import { openHubStore, resolveWorkspaceFlag } from './add/shared.js';

interface Options {
  workspace?: string;
}

function summarize(workspace: Workspace): { configured: string[]; missing: string[] } {
  const s = workspace.settings ?? {};
  const configured: string[] = [];
  const missing: string[] = [];

  const check = (label: string, len: number): void => {
    if (len > 0) { configured.push(label); } else { missing.push(label); }
  };
  check('jira', s.jiraProjectKeys?.length ?? 0);
  check('git', s.gitRepoPaths?.length ?? 0);
  check('github', s.githubRepos?.length ?? 0);
  check('csv', s.csvFilePaths?.length ?? 0);
  check('db', s.dbConfigs?.length ?? 0);

  return { configured, missing };
}

export function registerSourceCommands(program: Command): void {
  const cmd = program
    .command('source')
    .description('Inspect sources bound to a workspace');

  cmd
    .command('list')
    .description('Show sources bound to a workspace')
    .option('--workspace <name>', 'Target workspace (defaults to active)')
    .action(async (options: Options) => {
      const { store, close } = await openHubStore();
      try {
        const workspaceId = await resolveWorkspaceFlag(store, options.workspace);
        const workspace = await store.getById(workspaceId);
        if (!workspace) {
          throw new Error(`Workspace "${workspaceId}" disappeared during resolution.`);
        }
        const { configured, missing } = summarize(workspace);

        console.log('');
        console.log(chalk.bold(`  Workspace: ${workspace.name}  ${chalk.dim(`[${workspace.id}]`)}`));
        console.log('');
        for (const source of ALL_SOURCES) {
          const meta = SOURCE_META[source];
          const bound = configured.includes(source);
          if (bound) {
            console.log(`    ${chalk.green('✓')} ${chalk.bold(meta.label)}`);
          } else if (missing.includes(source)) {
            console.log(`    ${chalk.dim('○')} ${chalk.dim(meta.label)} — ${chalk.dim('not bound')}`);
          }
        }
        console.log('');
        console.log(chalk.dim('  Bind a source: argustack add <jira|git|github|csv|db|code> --workspace ' + workspace.id));
        console.log('');
      } finally {
        await close();
      }
    });
}
