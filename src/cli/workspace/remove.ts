import type { Command } from 'commander';
import chalk from 'chalk';
import { confirm } from '@inquirer/prompts';
import {
  clearActiveWorkspace,
  getActiveWorkspaceId,
} from '../../workspace/active-workspace.js';
import { openHubStore } from './shared.js';

interface Options {
  yes?: boolean;
}

export function registerRemoveCommand(group: Command): void {
  group
    .command('remove <name>')
    .description('Delete a workspace and all its data (CASCADE across 24 tenant tables)')
    .option('-y, --yes', 'Skip confirmation prompt')
    .action(async (name: string, opts: Options) => {
      const { store, close } = await openHubStore();
      try {
        const workspace = (await store.getById(name)) ?? (await store.getByName(name));
        if (!workspace) {
          throw new Error(`Workspace "${name}" not found.`);
        }

        if (!opts.yes) {
          const confirmed = await confirm({
            message:
              `Delete workspace "${workspace.name}" (id=${workspace.id})?\n` +
              `  This will CASCADE-delete all issues, commits, PRs, graph data,\n` +
              `  code index, and observations for this workspace.`,
            default: false,
          });
          if (!confirmed) {
            console.log(chalk.dim('  Cancelled.'));
            return;
          }
        }

        await store.remove(workspace.id);
        console.log(chalk.green(`  ● removed workspace "${workspace.name}" (Postgres CASCADE complete)`));
        console.log(chalk.dim('    Neo4j project node and Qdrant collection are NOT auto-cleaned'));
        console.log(chalk.dim('    — they need a separate `argustack code unregister` if used.'));

        if (getActiveWorkspaceId() === workspace.id) {
          clearActiveWorkspace();
          console.log(chalk.dim('  ● cleared active-workspace.json'));
        }
      } finally {
        await close();
      }
    });
}
