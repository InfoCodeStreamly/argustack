import type { Command } from 'commander';
import chalk from 'chalk';
import { getActiveWorkspaceId } from '../../workspace/active-workspace.js';
import { openHubStore } from './shared.js';

export function registerListCommand(group: Command): void {
  group
    .command('list')
    .description('List all workspaces from the hub')
    .action(async () => {
      const { store, close } = await openHubStore();
      try {
        const all = await store.list();
        const activeId = getActiveWorkspaceId();

        if (all.length === 0) {
          console.log(chalk.yellow('\n  No workspaces in the hub.'));
          console.log(chalk.dim('  Run "argustack workspace add <name>" to create one.\n'));
          return;
        }

        console.log(`\n  Workspaces (${String(all.length)}):\n`);
        for (const w of all) {
          const isActive = w.id === activeId;
          const marker = isActive ? chalk.green('●') : chalk.dim('○');
          const name = isActive ? chalk.green.bold(w.name) : w.name;
          const suffix = isActive ? chalk.dim(' (active)') : '';
          console.log(`  ${marker} ${name}${suffix}  ${chalk.dim(`[${w.id}]`)}`);
          if (w.lastActiveAt) {
            console.log(chalk.dim(`    last active: ${w.lastActiveAt}`));
          }
        }
        console.log('');
      } finally {
        await close();
      }
    });
}
