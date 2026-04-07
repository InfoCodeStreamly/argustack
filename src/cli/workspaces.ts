import type { Command } from 'commander';
import chalk from 'chalk';
import { findWorkspaceRoot } from '../workspace/resolver.js';
import { readConfig } from '../workspace/config.js';
import { listRegisteredWorkspaces, registerWorkspace } from '../workspace/registry.js';
import { SOURCE_META } from '../core/types/index.js';

export function registerWorkspacesCommand(program: Command): void {
  program
    .command('workspaces')
    .description('List all known Argustack workspaces')
    .action(() => {
      const activeRoot = findWorkspaceRoot() ?? undefined;

      if (activeRoot) {
        const config = readConfig(activeRoot);
        registerWorkspace(activeRoot, config?.name);
      }

      const workspaces = listRegisteredWorkspaces(activeRoot);

      if (workspaces.length === 0) {
        console.log(chalk.yellow('\n  No workspaces registered.'));
        console.log(chalk.dim('  Run "argustack init" to create one.\n'));
        return;
      }

      console.log(`\n  Workspaces (${String(workspaces.length)}):\n`);

      for (const ws of workspaces) {
        const marker = ws.active ? chalk.green('●') : chalk.dim('○');
        const name = ws.active ? chalk.green.bold(ws.name) : ws.name;
        const sources = ws.sources.map((s) => SOURCE_META[s].label).join(', ') || 'no sources';
        const activeSuffix = ws.active ? chalk.dim(' (active)') : '';

        console.log(`  ${marker} ${name}${activeSuffix}`);
        console.log(chalk.dim(`    ${ws.path}`));
        console.log(chalk.dim(`    ${sources}\n`));
      }
    });
}
