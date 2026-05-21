import type { Command } from 'commander';
import { registerListCommand } from './list.js';
import { registerAddCommand } from './add.js';
import { registerUseCommand } from './use.js';
import { registerRemoveCommand } from './remove.js';
import { registerInfoCommand } from './info.js';

export function registerWorkspaceCommands(program: Command): void {
  const group = program
    .command('workspace')
    .description('Manage hub workspaces (list / add / use / remove / info)');

  registerListCommand(group);
  registerAddCommand(group);
  registerUseCommand(group);
  registerRemoveCommand(group);
  registerInfoCommand(group);
}
