import type { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import dotenv from 'dotenv';
import { requireWorkspace } from '../workspace/resolver.js';
import { readConfig, getEnabledSources } from '../workspace/config.js';
import { JiraProvider } from '../adapters/jira/index.js';
import { GitProvider } from '../adapters/git/index.js';
import { PostgresStorage } from '../adapters/postgres/index.js';
import { PullUseCase } from '../use-cases/pull.js';
import { PullGitUseCase } from '../use-cases/pull-git.js';
import { GitHubProvider } from '../adapters/github/index.js';
import { PullGitHubUseCase } from '../use-cases/pull-github.js';
import type { SourceType } from '../core/types/index.js';
import { ALL_SOURCES, SOURCE_META } from '../core/types/index.js';

/**
 * Create PostgresStorage from workspace .env.
 */
function createStorage(workspaceRoot: string): PostgresStorage {
  dotenv.config({ path: `${workspaceRoot}/.env`, quiet: true });

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
  dotenv.config({ path: `${workspaceRoot}/.env`, quiet: true });

  const jiraUrl = process.env['JIRA_URL'];
  const jiraEmail = process.env['JIRA_EMAIL'];
  const jiraToken = process.env['JIRA_API_TOKEN'];

  if (!jiraUrl || !jiraEmail || !jiraToken) {
    console.log(chalk.red('  Missing Jira credentials in .env'));
    console.log(chalk.dim('  Required: JIRA_URL, JIRA_EMAIL, JIRA_API_TOKEN'));
    process.exit(1);
  }

  const configuredProjects = (process.env['JIRA_PROJECTS'] ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

  const source = new JiraProvider({
    host: jiraUrl,
    email: jiraEmail,
    apiToken: jiraToken,
  });

  const storage = createStorage(workspaceRoot);
  const spinner = ora('Syncing Jira...').start();

  try {
    const projectKeys = options.project
      ? [options.project]
      : configuredProjects.length > 0
        ? configuredProjects
        : null;

    if (projectKeys) {
      const allResults = [];
      for (const projectKey of projectKeys) {
        const pullUseCase = new PullUseCase(source, storage);
        const results = await pullUseCase.execute({
          projectKey,
          ...(options.since ? { since: options.since } : {}),
          onProgress: (msg) => { spinner.text = msg; },
        });
        allResults.push(...results);
      }

      spinner.succeed('Jira sync complete!');
      console.log('');
      for (const r of allResults) {
        console.log(
          chalk.green(
            `  ${r.projectKey}: ${String(r.issuesCount)} issues, ${String(r.commentsCount)} comments, ${String(r.changelogsCount)} changelogs`,
          ),
        );
      }
    } else {
      const pullUseCase = new PullUseCase(source, storage);
      const results = await pullUseCase.execute({
        ...(options.since ? { since: options.since } : {}),
        onProgress: (msg) => { spinner.text = msg; },
      });

      spinner.succeed('Jira sync complete!');
      console.log('');
      for (const r of results) {
        console.log(
          chalk.green(
            `  ${r.projectKey}: ${String(r.issuesCount)} issues, ${String(r.commentsCount)} comments, ${String(r.changelogsCount)} changelogs`,
          ),
        );
      }
    }
    console.log('');
  } finally {
    await storage.close();
  }
}

/**
 * Sync Git data → PostgreSQL.
 */
async function syncGit(
  workspaceRoot: string,
  options: { since?: string },
): Promise<void> {
  dotenv.config({ path: `${workspaceRoot}/.env`, quiet: true });

  const gitRepoPath = process.env['GIT_REPO_PATH'];

  if (!gitRepoPath) {
    console.log(chalk.red('  Missing Git repo path in .env'));
    console.log(chalk.dim('  Required: GIT_REPO_PATH'));
    process.exit(1);
  }

  const git = new GitProvider(gitRepoPath);
  const storage = createStorage(workspaceRoot);
  const spinner = ora('Syncing Git...').start();

  try {
    const pullGit = new PullGitUseCase(git, storage);
    const since = options.since ? new Date(options.since) : undefined;

    const result = await pullGit.execute(gitRepoPath, {
      ...(since ? { since } : {}),
      onProgress: (msg) => { spinner.text = msg; },
    });

    spinner.succeed('Git sync complete!');
    console.log('');
    console.log(
      chalk.green(
        `  ${result.commitsCount} commits, ${result.filesCount} files, ${result.issueRefsCount} issue refs`,
      ),
    );

    // GitHub API — PRs, reviews, releases (optional, requires GITHUB_TOKEN)
    const githubToken = process.env['GITHUB_TOKEN'];
    const githubOwner = process.env['GITHUB_OWNER'];
    const githubRepo = process.env['GITHUB_REPO'];

    if (githubToken && githubOwner && githubRepo) {
      spinner.start('Syncing GitHub PRs...');

      const github = new GitHubProvider({
        token: githubToken,
        owner: githubOwner,
        repo: githubRepo,
      });

      const pullGithub = new PullGitHubUseCase(github, storage);
      const repoFullName = `${githubOwner}/${githubRepo}`;
      const ghSince = options.since ? new Date(options.since) : undefined;

      const ghResult = await pullGithub.execute(repoFullName, {
        ...(ghSince ? { since: ghSince } : {}),
        onProgress: (msg) => { spinner.text = msg; },
      });

      spinner.succeed('GitHub sync complete!');
      console.log(
        chalk.green(
          `  ${ghResult.prsCount} PRs, ${ghResult.reviewsCount} reviews, ${ghResult.releasesCount} releases`,
        ),
      );
    }

    console.log('');
  } finally {
    await storage.close();
  }
}

/**
 * Called from `argustack init` to run first sync immediately after workspace creation.
 * Always passes epoch date to force a full pull — Docker volume may contain stale data
 * from a previous workspace, making incremental pull return 0 results.
 */
export async function syncJiraFromInit(workspaceRoot: string): Promise<void> {
  await syncJira(workspaceRoot, { since: '1970-01-01' });
}

export async function syncGitFromInit(workspaceRoot: string): Promise<void> {
  await syncGit(workspaceRoot, { since: '1970-01-01' });
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
              await syncGit(workspaceRoot, options);
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
