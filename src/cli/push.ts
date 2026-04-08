import type { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import dotenv from 'dotenv';
import { requireWorkspace } from '../workspace/resolver.js';
import { JiraProvider } from '../adapters/jira/index.js';
import { PostgresStorage } from '../adapters/postgres/index.js';
import { PushUseCase } from '../use-cases/push.js';
import { updateMdFrontmatter } from '../adapters/board/md-parser.js';

export function registerPushCommand(program: Command): void {
  program
    .command('push')
    .description('Push local board tasks to Jira')
    .option('--updates', 'Push locally modified issues to Jira (update existing)')
    .action(async (options: { updates?: boolean }) => {
      const workspaceRoot = requireWorkspace();
      dotenv.config({ path: `${workspaceRoot}/.env`, quiet: true });

      const jiraUrl = process.env['JIRA_URL'];
      const jiraEmail = process.env['JIRA_EMAIL'];
      const jiraToken = process.env['JIRA_API_TOKEN'];

      if (!jiraUrl || !jiraEmail || !jiraToken) {
        console.log(chalk.red('\n  Jira credentials not configured.'));
        console.log(chalk.dim('  Set JIRA_URL, JIRA_EMAIL, JIRA_API_TOKEN in .env'));
        process.exit(1);
      }

      const jira = new JiraProvider({ host: jiraUrl, email: jiraEmail, apiToken: jiraToken });
      const storage = new PostgresStorage({
        host: process.env['DB_HOST'] ?? 'localhost',
        port: parseInt(process.env['DB_PORT'] ?? '5434', 10),
        database: process.env['DB_NAME'] ?? 'argustack',
        user: process.env['DB_USER'] ?? 'argustack',
        password: process.env['DB_PASSWORD'] ?? 'argustack_local',
      });

      await storage.initialize();

      const useCase = new PushUseCase(jira, storage);

      if (options.updates) {
        const spinner = ora('Pushing modified issues to Jira...').start();
        try {
          const progressLines: string[] = [];
          const result = await useCase.executeUpdates({
            onProgress: (msg) => {
              progressLines.push(msg);
              spinner.text = msg;
            },
          });

          spinner.succeed(
            `Updated ${String(result.updated.length)} issue(s)` +
            (result.errors > 0 ? `, ${String(result.errors)} error(s)` : ''),
          );

          for (const item of result.updated) {
            console.log(`  ${chalk.green('✓')} ${item.key} — ${item.summary}`);
          }

          if (result.errors > 0) {
            for (const line of progressLines.filter((l) => l.includes('Failed'))) {
              console.log(`  ${chalk.red('✗')} ${line.trim()}`);
            }
          }
        } catch (err: unknown) {
          spinner.fail('Push updates failed');
          console.error(chalk.red(`  ${err instanceof Error ? err.message : String(err)}`));
          process.exit(1);
        } finally {
          await storage.close();
        }
        return;
      }

      const spinner = ora('Pushing local tasks to Jira...').start();
      try {
        const result = await useCase.execute({
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
      } catch (err: unknown) {
        spinner.fail('Push failed');
        console.error(chalk.red(`  ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
      } finally {
        await storage.close();
      }
    });
}
