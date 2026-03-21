import type { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import dotenv from 'dotenv';
import { requireWorkspace } from '../workspace/resolver.js';
import { readConfig, getEnabledSources } from '../workspace/config.js';
import { JiraProvider } from '../adapters/jira/index.js';
import { GitProvider } from '../adapters/git/index.js';
import { CsvProvider } from '../adapters/csv/index.js';
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
 * Supports multiple repos via GIT_REPO_PATHS (comma-separated).
 * Falls back to GIT_REPO_PATH for backwards compatibility.
 */
async function syncGit(
  workspaceRoot: string,
  options: { since?: string },
): Promise<void> {
  dotenv.config({ path: `${workspaceRoot}/.env`, quiet: true });

  const rawPaths = process.env['GIT_REPO_PATHS'] ?? process.env['GIT_REPO_PATH'];

  if (!rawPaths) {
    console.log(chalk.red('  Missing Git repo paths in .env'));
    console.log(chalk.dim('  Required: GIT_REPO_PATHS'));
    process.exit(1);
  }

  const repoPaths = rawPaths.split(',').map((p) => p.trim()).filter(Boolean);

  if (repoPaths.length === 0) {
    console.log(chalk.red('  No Git repo paths configured in .env'));
    process.exit(1);
  }

  const storage = createStorage(workspaceRoot);
  const spinner = ora('Syncing Git...').start();

  try {
    const since = options.since ? new Date(options.since) : undefined;

    for (const repoPath of repoPaths) {
      const repoName = repoPath.split('/').pop() ?? repoPath;
      spinner.text = `Syncing Git: ${repoName}...`;

      try {
        const git = new GitProvider(repoPath);
        const pullGit = new PullGitUseCase(git, storage);

        const result = await pullGit.execute(repoPath, {
          ...(since ? { since } : {}),
          onProgress: (msg) => { spinner.text = msg; },
        });

        console.log(
          chalk.green(
            `  ✓ ${repoName}: ${String(result.commitsCount)} commits, ${String(result.filesCount)} files, ${String(result.issueRefsCount)} issue refs`,
          ),
        );
      } catch (err: unknown) {
        console.log(
          chalk.red(`  ✗ ${repoName}: ${err instanceof Error ? err.message : String(err)}`),
        );
      }
    }

    spinner.succeed('Git sync complete!');
    console.log('');
  } finally {
    await storage.close();
  }
}

/**
 * Sync GitHub data → PostgreSQL.
 */
async function syncGithub(
  workspaceRoot: string,
  options: { since?: string },
): Promise<void> {
  dotenv.config({ path: `${workspaceRoot}/.env`, quiet: true });

  const githubToken = process.env['GITHUB_TOKEN'];
  const githubOwner = process.env['GITHUB_OWNER'];
  const githubRepo = process.env['GITHUB_REPO'];

  if (!githubToken || !githubOwner || !githubRepo) {
    console.log(chalk.red('  Missing GitHub credentials in .env'));
    console.log(chalk.dim('  Required: GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO'));
    process.exit(1);
  }

  const github = new GitHubProvider({
    token: githubToken,
    owner: githubOwner,
    repo: githubRepo,
  });

  const storage = createStorage(workspaceRoot);
  const spinner = ora('Syncing GitHub PRs...').start();

  try {
    const pullGithub = new PullGitHubUseCase(github, storage);
    const repoFullName = `${githubOwner}/${githubRepo}`;
    const since = options.since ? new Date(options.since) : undefined;

    const result = await pullGithub.execute(repoFullName, {
      ...(since ? { since } : {}),
      onProgress: (msg) => { spinner.text = msg; },
    });

    spinner.succeed('GitHub sync complete!');
    console.log('');
    console.log(
      chalk.green(
        `  ${result.prsCount} PRs, ${result.reviewsCount} reviews, ${result.releasesCount} releases`,
      ),
    );
    console.log('');
  } finally {
    await storage.close();
  }
}

/**
 * Sync Jira CSV file → PostgreSQL.
 */
async function syncCsv(
  workspaceRoot: string,
  options: { project?: string; since?: string; file?: string },
): Promise<void> {
  dotenv.config({ path: `${workspaceRoot}/.env`, quiet: true });

  const csvFilePath = options.file ?? process.env['CSV_FILE_PATH'];

  if (!csvFilePath) {
    console.log(chalk.red('  Missing CSV file path'));
    console.log(chalk.dim('  Use --file <path> or set CSV_FILE_PATH in .env'));
    process.exit(1);
  }

  const source = new CsvProvider(csvFilePath);
  const storage = createStorage(workspaceRoot);
  const spinner = ora('Importing Jira CSV...').start();

  try {
    const projects = await source.getProjects();
    const projectKeys = options.project
      ? [options.project]
      : projects.map((p) => p.key);

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

    spinner.succeed('CSV import complete!');
    console.log('');
    for (const r of allResults) {
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

export async function syncGithubFromInit(workspaceRoot: string): Promise<void> {
  await syncGithub(workspaceRoot, { since: '1970-01-01' });
}

export async function syncCsvFromInit(workspaceRoot: string, filePath?: string): Promise<void> {
  await syncCsv(workspaceRoot, { since: '1970-01-01', ...(filePath ? { file: filePath } : {}) });
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
    .option('-f, --file <path>', 'CSV file path (for csv source)')
    .action(async (type: string | undefined, options: { project?: string; since?: string; file?: string }) => {
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

        // Migration hint: GitHub token exists but 'github' source not enabled
        dotenv.config({ path: `${workspaceRoot}/.env`, quiet: true });
        const githubToken = process.env['GITHUB_TOKEN'];
        const githubEnabled = config.sources.github?.enabled;
        if (githubToken && !githubEnabled && !type) {
          console.log(chalk.yellow('  ⚠ GitHub token found in .env but "github" source is not enabled.'));
          console.log(chalk.dim(`    Enable: ${chalk.cyan('argustack source add github')}\n`));
        }

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
            case 'github': {
              await syncGithub(workspaceRoot, options);
              break;
            }
            case 'csv': {
              await syncCsv(workspaceRoot, options);
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
