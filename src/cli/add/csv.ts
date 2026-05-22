import { resolve } from 'node:path';
import type { Command } from 'commander';
import chalk from 'chalk';
import { appendToListSetting, openHubStore, resolveWorkspaceFlag } from './shared.js';

interface Options {
  workspace?: string;
  file?: string;
}

export function registerCsvCommand(group: Command): void {
  group
    .command('csv')
    .description('Bind a Jira CSV export to a workspace')
    .option('--workspace <name>', 'Target workspace (defaults to active)')
    .requiredOption('--file <path>', 'Path to Jira CSV export')
    .action(async (opts: Options) => {
      if (opts.file === undefined || opts.file === '') {
        throw new Error('--file is required.');
      }
      const absolute = resolve(opts.file);

      const { store, close } = await openHubStore();
      try {
        const workspaceId = await resolveWorkspaceFlag(store, opts.workspace);
        await appendToListSetting(store, workspaceId, 'csvFilePaths', [{ path: absolute }]);
        console.log(chalk.green(`  ● added CSV ${absolute} to workspace "${workspaceId}"`));
      } finally {
        await close();
      }
    });
}
