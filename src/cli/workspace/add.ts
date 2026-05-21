import type { Command } from 'commander';
import chalk from 'chalk';
import { setActiveWorkspace } from '../../workspace/active-workspace.js';
import { openHubStore, sanitizeSlug } from './shared.js';

interface Options {
  use?: boolean;
  displayName?: string;
}

export function registerAddCommand(group: Command): void {
  group
    .command('add <name>')
    .description('Register a new workspace in the hub')
    .option('--use', 'Set the new workspace as active')
    .option('--display-name <display>', 'Human-friendly display name')
    .action(async (name: string, opts: Options) => {
      const slug = sanitizeSlug(name);
      if (!slug) {
        throw new Error('Workspace name must contain at least one alphanumeric character.');
      }

      const { store, close } = await openHubStore();
      try {
        const existing = await store.getById(slug);
        if (existing) {
          console.log(chalk.yellow(`  workspace "${slug}" already exists`));
        }
        const workspace = await store.create({
          id: slug,
          name: slug,
          ...(opts.displayName ? { displayName: opts.displayName } : {}),
        });
        console.log(chalk.green(`  ● workspace "${workspace.name}" ready  ${chalk.dim(`[${workspace.id}]`)}`));

        if (opts.use) {
          setActiveWorkspace(workspace.id, workspace.name);
          await store.touchActive(workspace.id);
          console.log(chalk.green(`  ● set as active`));
        }
      } finally {
        await close();
      }
    });
}
