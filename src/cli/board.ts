import type { Command } from 'commander';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import chalk from 'chalk';

export function registerBoardCommand(program: Command): void {
  program
    .command('board')
    .description('Start local Kanban board UI')
    .option('-p, --port <port>', 'Port number', '5002')
    .action(async (opts: { port: string }) => {
      const { findWorkspaceRoot } = await import('../workspace/resolver.js');
      const wsRoot = findWorkspaceRoot();

      if (!wsRoot) {
        console.log(chalk.red('No workspace found. Run: argustack init'));
        process.exit(1);
      }

      const tasksDir = join(wsRoot, 'Docs', 'Tasks');
      if (!existsSync(tasksDir)) {
        console.log(chalk.yellow(`No Docs/Tasks/ directory found in ${wsRoot}`));
        console.log(chalk.dim('Board will start empty. Create task files to populate it.'));
      }

      const port = parseInt(opts.port, 10);
      const { startBoardServer } = await import('./board-server.js');
      await startBoardServer(wsRoot, port);
    });
}
