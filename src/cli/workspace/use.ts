import type { Command } from 'commander';
import chalk from 'chalk';
import { setActiveWorkspace } from '../../workspace/active-workspace.js';
import { openHubStore } from './shared.js';

export function registerUseCommand(group: Command): void {
  group
    .command('use <name>')
    .description('Set the active workspace (writes ~/.argustack/active-workspace.json)')
    .action(async (name: string) => {
      const { store, close } = await openHubStore();
      try {
        const workspace = (await store.getById(name)) ?? (await store.getByName(name));
        if (!workspace) {
          const all = await store.list();
          const names = all.map((w) => w.name).join(', ') || 'none';
          throw new Error(`Workspace "${name}" not found. Available: ${names}`);
        }
        setActiveWorkspace(workspace.id, workspace.name);
        await store.touchActive(workspace.id);
        console.log(chalk.green(`  ● active workspace: ${workspace.name}  ${chalk.dim(`[${workspace.id}]`)}`));
      } finally {
        await close();
      }
    });
}
