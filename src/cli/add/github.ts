import type { Command } from 'commander';
import chalk from 'chalk';
import {
  appendToListSetting,
  openHubStore,
  resolveWorkspaceFlag,
  upsertHubEnv,
} from './shared.js';

interface Options {
  workspace?: string;
  owner?: string;
  repo?: string;
  token?: string;
}

export function registerGithubCommand(group: Command): void {
  group
    .command('github')
    .description('Bind a GitHub repository to a workspace')
    .option('--workspace <name>', 'Target workspace (defaults to active)')
    .requiredOption('--owner <owner>', 'GitHub owner/org')
    .requiredOption('--repo <repo>', 'GitHub repository name')
    .option('--token <token>', 'GitHub PAT — stored in ~/.argustack/config.env')
    .action(async (opts: Options) => {
      if (opts.owner === undefined || opts.owner === '' || opts.repo === undefined || opts.repo === '') {
        throw new Error('--owner and --repo are required.');
      }

      if (opts.token !== undefined && opts.token !== '') {
        upsertHubEnv({ GITHUB_TOKEN: opts.token });
        console.log(chalk.dim('  ● updated hub credentials (GITHUB_TOKEN)'));
      }

      const { store, close } = await openHubStore();
      try {
        const workspaceId = await resolveWorkspaceFlag(store, opts.workspace);
        await appendToListSetting(store, workspaceId, 'githubRepos', [
          { owner: opts.owner, repo: opts.repo },
        ]);
        console.log(
          chalk.green(`  ● added github repo ${opts.owner}/${opts.repo} to workspace "${workspaceId}"`),
        );
      } finally {
        await close();
      }
    });
}
