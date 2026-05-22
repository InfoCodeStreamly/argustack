import type { Command } from 'commander';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import chalk from 'chalk';
import { findLegacyWorkspaceRoot } from '../workspace/resolver.js';

interface Options {
  port: string;
  root?: string;
}

export function registerBoardCommand(program: Command): void {
  program
    .command('board')
    .description('Start local Kanban board UI for a project directory')
    .option('-p, --port <port>', 'Port number', '5002')
    .option('--root <path>', 'Project root containing Docs/Tasks/ (default: legacy .argustack/ walk-up, then cwd)')
    .action(async (opts: Options) => {
      const projectRoot = opts.root !== undefined && opts.root.length > 0
        ? resolve(opts.root)
        : (findLegacyWorkspaceRoot() ?? process.cwd());

      const tasksDir = join(projectRoot, 'Docs', 'Tasks');
      if (!existsSync(tasksDir)) {
        console.log(chalk.yellow(`  No Docs/Tasks/ in ${projectRoot}`));
        console.log(chalk.dim('  Pass --root /path/to/project to point at the right folder.'));
      }

      const port = parseInt(opts.port, 10);
      const { startBoardServer } = await import('./board-server.js');
      await startBoardServer(projectRoot, port);
    });
}
