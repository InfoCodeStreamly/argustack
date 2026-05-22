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
  url?: string;
  email?: string;
  token?: string;
  projects?: string;
}

export function registerJiraCommand(group: Command): void {
  group
    .command('jira')
    .description('Bind Jira projects to a workspace')
    .option('--workspace <name>', 'Target workspace (defaults to active)')
    .option('--url <url>', 'Jira base URL — stored in ~/.argustack/config.env')
    .option('--email <email>', 'Jira account email — stored in hub config')
    .option('--token <token>', 'Jira API token — stored in hub config')
    .option('--projects <keys>', 'Comma-separated Jira project keys (e.g. ARG,PAP)')
    .action(async (opts: Options) => {
      if (opts.projects === undefined || opts.projects === '') {
        throw new Error('--projects is required (comma-separated Jira project keys).');
      }
      const projects = opts.projects.split(',').map((s) => s.trim()).filter((s) => s !== '');
      if (projects.length === 0) {
        throw new Error('--projects must list at least one project key.');
      }

      const credentialsPatch: Record<string, string> = {};
      if (opts.url !== undefined && opts.url !== '') { credentialsPatch['JIRA_URL'] = opts.url; }
      if (opts.email !== undefined && opts.email !== '') { credentialsPatch['JIRA_EMAIL'] = opts.email; }
      if (opts.token !== undefined && opts.token !== '') { credentialsPatch['JIRA_API_TOKEN'] = opts.token; }
      if (Object.keys(credentialsPatch).length > 0) {
        upsertHubEnv(credentialsPatch);
        console.log(chalk.dim('  ● updated hub credentials (config.env)'));
      }

      const { store, close } = await openHubStore();
      try {
        const workspaceId = await resolveWorkspaceFlag(store, opts.workspace);
        await appendToListSetting(store, workspaceId, 'jiraProjectKeys', projects);
        console.log(
          chalk.green(`  ● added jira projects [${projects.join(', ')}] to workspace "${workspaceId}"`),
        );
      } finally {
        await close();
      }
    });
}
