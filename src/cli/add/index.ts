import type { Command } from 'commander';
import { registerJiraCommand } from './jira.js';
import { registerGitCommand } from './git.js';
import { registerGithubCommand } from './github.js';
import { registerCsvCommand } from './csv.js';
import { registerDbCommand } from './db.js';
import { registerCodeCommand } from './code.js';

export function registerAddCommands(program: Command): void {
  const group = program
    .command('add')
    .description('Bind a source to a workspace (jira / git / github / csv / db / code)');

  registerJiraCommand(group);
  registerGitCommand(group);
  registerGithubCommand(group);
  registerCsvCommand(group);
  registerDbCommand(group);
  registerCodeCommand(group);
}
