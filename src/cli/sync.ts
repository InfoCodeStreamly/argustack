import type { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import dotenv from 'dotenv';
import { requireWorkspace } from '../workspace/resolver.js';
import { readConfig, getEnabledSources } from '../workspace/config.js';
import { JiraProvider } from '../adapters/jira/index.js';
import { PostgresStorage } from '../adapters/postgres/index.js';
import type { PullOptions } from '../use-cases/pull.js';
import { PullUseCase } from '../use-cases/pull.js';
import type { SourceType } from '../core/types/index.js';
import { ALL_SOURCES, SOURCE_META } from '../core/types/index.js';

/**
 * Create PostgresStorage from workspace .env.
 */
function createStorage(workspaceRoot: string): PostgresStorage {
  dotenv.config({ path: `${workspaceRoot}/.env` });

  return new PostgresStorage({
    host: process.env['DB_HOST'] ?? 'localhost',
    port: parseInt(process.env['DB_PORT'] ?? '5434', 10),
    user: process.env['DB_USER'] ?? 'argustack',
    password: process.env['DB_PASSWORD'] ?? 'argustack_local',
    database: process.env['DB_NAME'] ?? 'argustack',
  });
}

/**
 * Sync Jira data → PostgreSQL.
 */
async function syncJira(
  workspaceRoot: string,
  options: { project?: string; since?: string },
): Promise<void> {
  dotenv.config({ path: `${workspaceRoot}/.env` });

  const jiraUrl = process.env['JIRA_URL'];
  const jiraEmail = process.env['JIRA_EMAIL'];
  const jiraToken = process.env['JIRA_API_TOKEN'];

  if (!jiraUrl || !jiraEmail || !jiraToken) {
    console.log(chalk.red('  Missing Jira credentials in .env'));
    console.log(chalk.dim('  Required: JIRA_URL, JIRA_EMAIL, JIRA_API_TOKEN'));
    process.exit(1);
  }

  const source = new JiraProvider({
    host: jiraUrl,
    email: jiraEmail,
    apiToken: jiraToken,
  });

  const storage = createStorage(workspaceRoot);
  const pullUseCase = new PullUseCase(source, storage);
  const spinner = ora('Syncing Jira...').start();

  try {
    const pullOptions: PullOptions = {
      onProgress: (msg) => {
        spinner.text = msg;
      },
    };
    if (options.project) {
      pullOptions.projectKey = options.project;
    }
    if (options.since) {
      pullOptions.since = options.since;
    }

    const results = await pullUseCase.execute(pullOptions);

    spinner.succeed('Jira sync complete!');
    console.log('');
    for (const r of results) {
      console.log(
        chalk.green(
          `  ${r.projectKey}: ${String(r.issuesCount)} issues, ${String(r.commentsCount)} comments, ${String(r.changelogsCount)} changelogs`,
        ),
      );
    }
    console.log('');
  } finally {
    await storage.close();
  }
}

/**
 * Register `argustack sync [type]` command.
 *
 * Usage:
 *   argustack sync              — sync all enabled sources
 *   argustack sync jira         — sync Jira only
 *   argustack sync jira -p KEY  — sync specific project
 *   argustack sync jira --since 2024-01-01
 */
export function registerSyncCommand(program: Command): void {
  program
    .command('sync [type]')
    .description('Sync data from sources (all enabled or specific)')
    .option('-p, --project <key>', 'Sync specific project only')
    .option('--since <date>', 'Sync issues updated since date (YYYY-MM-DD)')
    .action(async (type: string | undefined, options: { project?: string; since?: string }) => {
      try {
        const workspaceRoot = requireWorkspace();
        const config = readConfig(workspaceRoot);

        if (!config) {
          console.log(chalk.red('\n  No config found. Run: argustack init'));
          process.exit(1);
        }

        // Determine which sources to sync
        let sourcesToSync: SourceType[];

        if (type) {
          const source = type.toLowerCase() as SourceType;
          if (!ALL_SOURCES.includes(source)) {
            console.log(chalk.red(`\n  Unknown source: ${type}`));
            console.log(chalk.dim(`  Available: ${ALL_SOURCES.join(', ')}`));
            process.exit(1);
          }
          if (!config.sources[source]?.enabled) {
            console.log(chalk.red(`\n  ${SOURCE_META[source].label} is not enabled.`));
            console.log(chalk.dim(`  Enable it: ${chalk.cyan(`argustack source add ${source}`)}`));
            process.exit(1);
          }
          sourcesToSync = [source];
        } else {
          sourcesToSync = getEnabledSources(config);
          if (sourcesToSync.length === 0) {
            console.log(chalk.yellow('\n  No sources enabled.'));
            console.log(chalk.dim(`  Add one: ${chalk.cyan('argustack source add jira')}`));
            process.exit(1);
          }
        }

        console.log('');

        // Sync each source in order
        for (const source of sourcesToSync) {
          switch (source) {
            case 'jira': {
              await syncJira(workspaceRoot, options);
              break;
            }
            case 'git': {
              console.log(chalk.dim(`  ○ Git sync — coming soon`));
              break;
            }
            case 'db': {
              console.log(chalk.dim(`  ○ Database sync — coming soon`));
              break;
            }
          }
        }
      } catch (err: unknown) {
        console.error(chalk.red(`\n  Error: ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
      }
    });
}
