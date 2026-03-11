import type { Command } from 'commander';

export function registerJiraCommands(program: Command): void {
  const jira = program.command('jira').description('Jira operations');

  jira
    .command('pull')
    .description('Pull all issues from Jira')
    .option('-p, --project <key>', 'Project key to pull')
    .option('--since <date>', 'Pull issues updated since date')
    .action(async (options) => {
      // TODO: implement
      console.log('jira pull', options);
    });
}
