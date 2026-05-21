import { resolve } from 'node:path';
import type { Command } from 'commander';
import chalk from 'chalk';
import { appendToListSetting, openHubStore, resolveWorkspaceFlag } from './shared.js';

interface Options {
  workspace?: string;
  root?: string;
}

export function registerGitCommand(group: Command): void {
  group
    .command('git')
    .description('Bind a local git repository to a workspace')
    .option('--workspace <name>', 'Target workspace (defaults to active)')
    .requiredOption('--root <path>', 'Absolute path to the local git repo')
    .action(async (opts: Options) => {
      if (!opts.root) {
        throw new Error('--root is required.');
      }
      const absolutePath = resolve(opts.root);

      const { store, close } = await openHubStore();
      try {
        const workspaceId = await resolveWorkspaceFlag(store, opts.workspace);
        await appendToListSetting(store, workspaceId, 'gitRepoPaths', [absolutePath]);
        console.log(chalk.green(`  ● added git repo ${absolutePath} to workspace "${workspaceId}"`));
      } finally {
        await close();
      }
    });
}
