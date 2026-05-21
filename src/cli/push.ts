import type { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { JiraProvider } from '../adapters/jira/index.js';
import {
  ProxyJiraProvider,
  loadProxyConfigForWorkspace,
  proxyConfigExistsForWorkspace,
} from '../adapters/jira-proxy/index.js';
import { PostgresStorage } from '../adapters/postgres/index.js';
import { PushUseCase } from '../use-cases/push.js';
import { updateMdFrontmatter } from '../adapters/board/md-parser.js';
import { loadHubConfig } from '../workspace/hub-config.js';
import { openHubStore, resolveWorkspaceFlag } from './add/shared.js';

interface Options {
  workspace?: string;
  updates?: boolean;
}

export function registerPushCommand(program: Command): void {
  program
    .command('push')
    .description('Push local board tasks (or modified issues) to Jira')
    .option('--workspace <name>', 'Target workspace (defaults to active)')
    .option('--updates', 'Push locally modified issues to Jira (update existing)')
    .action(async (options: Options) => {
      const hub = loadHubConfig();
      const { store, close } = await openHubStore();
      const storage = new PostgresStorage(hub.db);
      try {
        const workspaceId = await resolveWorkspaceFlag(store, options.workspace);
        await storage.initialize();

        const jira = proxyConfigExistsForWorkspace(workspaceId)
          ? new ProxyJiraProvider(loadProxyConfigForWorkspace(workspaceId))
          : (hub.credentials.jiraUrl && hub.credentials.jiraEmail && hub.credentials.jiraApiToken)
            ? new JiraProvider({
                host: hub.credentials.jiraUrl,
                email: hub.credentials.jiraEmail,
                apiToken: hub.credentials.jiraApiToken,
              })
            : null;

        if (!jira) {
          console.log(chalk.red('\n  Jira credentials missing in ~/.argustack/config.env (and no proxy config).'));
          process.exit(1);
        }

        const useCase = new PushUseCase(jira, storage);

        if (options.updates) {
          const spinner = ora('Pushing modified issues to Jira...').start();
          try {
            const result = await useCase.executeUpdates(workspaceId, {
              onProgress: (msg) => { spinner.text = msg; },
            });
            spinner.succeed(
              `Updated ${String(result.updated.length)} issue(s)` +
              (result.errors > 0 ? `, ${String(result.errors)} error(s)` : ''),
            );
            for (const item of result.updated) {
              console.log(`  ${chalk.green('✓')} ${item.key} — ${item.summary}`);
            }
          } catch (err) {
            spinner.fail('Push updates failed');
            console.error(chalk.red(`  ${err instanceof Error ? err.message : String(err)}`));
            process.exit(1);
          }
          return;
        }

        const spinner = ora('Pushing local tasks to Jira...').start();
        try {
          const result = await useCase.execute(workspaceId, {
            onProgress: (msg) => { spinner.text = msg; },
          });

          for (const item of result.created) {
            if (item.mdPath) {
              updateMdFrontmatter(item.mdPath, { jiraKey: item.newKey });
            }
          }

          spinner.succeed(
            `Pushed! Created ${String(result.created.length)} issue(s)` +
            (result.errors > 0 ? `, ${String(result.errors)} error(s)` : ''),
          );
          for (const item of result.created) {
            console.log(`  ${chalk.green('✓')} ${item.newKey} — ${chalk.dim(item.oldKey)}`);
          }
        } catch (err) {
          spinner.fail('Push failed');
          console.error(chalk.red(`  ${err instanceof Error ? err.message : String(err)}`));
          process.exit(1);
        }
      } finally {
        await storage.close();
        await close();
      }
    });
}
