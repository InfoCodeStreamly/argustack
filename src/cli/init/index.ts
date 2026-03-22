import { input, confirm, checkbox } from '@inquirer/prompts';
import { execSync } from 'node:child_process';
import chalk from 'chalk';
import ora from 'ora';
import { isWorkspace } from '../../workspace/resolver.js';
import type { SourceType } from '../../core/types/index.js';
import { ALL_SOURCES, SOURCE_META } from '../../core/types/index.js';
import type {
  InitFlags,
  JiraSetupResult,
  GitSetupResult,
  GitHubSetupResult,
  CsvSetupResult,
  DbSetupResult,
} from './types.js';
import { DEFAULT_DB_PORT, DEFAULT_PGWEB_PORT, resolvePath, validatePort, getErrorMsg } from './types.js';
import { setupJiraInteractive, setupJiraFromFlags } from './setup-jira.js';
import { setupGitInteractive, setupGitFromFlags } from './setup-git.js';
import { setupGithubInteractive, setupGithubFromFlags } from './setup-github.js';
import { setupCsvInteractive, setupCsvFromFlags } from './setup-csv.js';
import { setupDbInteractive, setupDbFromFlags } from './setup-db.js';
import { createWorkspaceFiles, printSummary } from './generators.js';

export type { InitFlags } from './types.js';

async function startAndSync(
  workspaceDir: string,
  hasJira: boolean,
  hasGit: boolean,
  hasGithub: boolean,
  csv: CsvSetupResult | null,
  pgwebPort: number,
): Promise<void> {
  const spinnerDb = ora('Starting Docker containers...').start();
  try {
    execSync('docker compose up -d', { cwd: workspaceDir, stdio: 'pipe' });
    spinnerDb.succeed('Database running!');
  } catch (err: unknown) {
    spinnerDb.fail('Failed to start Docker');
    console.log(chalk.red(`  Error: ${getErrorMsg(err)}`));
    console.log(chalk.dim('  Make sure Docker Desktop is running, then:'));
    console.log(chalk.cyan(`  cd ${workspaceDir} && docker compose up -d`));
    return;
  }

  const spinnerWait = ora('Waiting for PostgreSQL...').start();
  const MAX_WAIT_SECONDS = 30;
  for (let i = 0; i < MAX_WAIT_SECONDS; i++) {
    try {
      execSync(
        'docker compose exec -T db pg_isready -U argustack',
        { cwd: workspaceDir, stdio: 'pipe' },
      );
      spinnerWait.succeed('PostgreSQL ready!');
      break;
    } catch {
      if (i === MAX_WAIT_SECONDS - 1) {
        spinnerWait.fail('PostgreSQL not ready after 30s');
        console.log(chalk.dim('  Try manually: docker compose logs db'));
        return;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  if (hasJira) {
    console.log('');
    try {
      const { syncJiraFromInit } = await import('../sync.js');
      await syncJiraFromInit(workspaceDir);
    } catch (err: unknown) {
      console.log(chalk.red(`  Jira sync failed: ${getErrorMsg(err)}`));
      console.log(chalk.dim(`  Try manually: cd ${workspaceDir} && argustack sync jira`));
    }
  }

  if (hasGit) {
    console.log('');
    try {
      const { syncGitFromInit } = await import('../sync.js');
      await syncGitFromInit(workspaceDir);
    } catch (err: unknown) {
      console.log(chalk.red(`  Git sync failed: ${getErrorMsg(err)}`));
      console.log(chalk.dim(`  Try manually: cd ${workspaceDir} && argustack sync git`));
    }
  }

  if (hasGithub) {
    console.log('');
    try {
      const { syncGithubFromInit } = await import('../sync.js');
      await syncGithubFromInit(workspaceDir);
    } catch (err: unknown) {
      console.log(chalk.red(`  GitHub sync failed: ${getErrorMsg(err)}`));
      console.log(chalk.dim(`  Try manually: cd ${workspaceDir} && argustack sync github`));
    }
  }

  if (csv) {
    console.log('');
    try {
      const { syncCsvFromInit } = await import('../sync.js');
      await syncCsvFromInit(workspaceDir, csv.csvFilePath);
    } catch (err: unknown) {
      console.log(chalk.red(`  CSV import failed: ${getErrorMsg(err)}`));
      console.log(chalk.dim(`  Try manually: cd ${workspaceDir} && argustack sync csv`));
    }
  }

  console.log(chalk.dim('  What\'s next:'));
  console.log(`  ${chalk.cyan(`http://localhost:${pgwebPort}`)}            # browse data in pgweb`);
  console.log('');
  console.log(chalk.dim('  Claude integration:'));
  console.log(`    Claude Code:    ${chalk.green('Open this folder — MCP tools ready!')}`);
  console.log(`    Claude Desktop: ${chalk.cyan('argustack mcp install')}`);
  console.log('');
}

async function runInitNonInteractive(flags: InitFlags): Promise<void> {
  console.log(chalk.bold('\n  Argustack — non-interactive setup\n'));

  const workspaceDir = resolvePath(flags.dir ?? process.cwd());

  const selectedSources: SourceType[] = flags.source
    ? (flags.source.split(',').map((s) => s.trim().toLowerCase()) as SourceType[])
    : [];

  for (const s of selectedSources) {
    if (!ALL_SOURCES.includes(s)) {
      throw new Error(`Unknown source: ${s}. Available: ${ALL_SOURCES.join(', ')}`);
    }
  }

  let jiraResult: JiraSetupResult | null = null;
  let gitResult: GitSetupResult | null = null;
  let githubResult: GitHubSetupResult | null = null;
  let csvResult: CsvSetupResult | null = null;
  let dbResult: DbSetupResult | null = null;

  for (const source of selectedSources) {
    switch (source) {
      case 'jira':
        jiraResult = await setupJiraFromFlags(flags);
        break;
      case 'git':
        gitResult = setupGitFromFlags(flags);
        break;
      case 'github':
        githubResult = setupGithubFromFlags(flags);
        break;
      case 'csv':
        csvResult = setupCsvFromFlags(flags);
        break;
      case 'db':
        dbResult = setupDbFromFlags(flags);
        break;
    }
  }

  const dbPort = parseInt(flags.dbPort ?? String(DEFAULT_DB_PORT), 10);
  const pgwebPort = parseInt(flags.pgwebPort ?? String(DEFAULT_PGWEB_PORT), 10);

  const spinner = ora('Creating workspace...').start();
  try {
    createWorkspaceFiles(workspaceDir, jiraResult, gitResult, githubResult, csvResult, dbResult, dbPort, pgwebPort);
    spinner.succeed('Workspace created!');
  } catch (err: unknown) {
    spinner.fail('Failed');
    throw err;
  }

  printSummary(workspaceDir, jiraResult, gitResult, githubResult, csvResult, dbResult, pgwebPort, false);
}

async function runInitInteractive(flags: InitFlags): Promise<void> {
  console.log('');
  console.log(chalk.bold('  Argustack — workspace setup'));
  console.log(chalk.dim('  Cross-reference Jira + Git + DB to analyze your project.\n'));

  const targetDir = await input({
    message: 'Workspace directory:',
    default: flags.dir ?? process.cwd(),
    validate: (val): string | true => {
      if (!val.trim()) {
        return 'Directory path is required';
      }
      return true;
    },
  });

  const workspaceDir = resolvePath(targetDir);

  if (isWorkspace(workspaceDir)) {
    console.log(chalk.yellow(`\n  Already an Argustack workspace: ${workspaceDir}`));
    const proceed = await confirm({ message: 'Reinitialize this workspace?', default: false });
    if (!proceed) {
      console.log(chalk.dim('  Cancelled.'));
      return;
    }
  }

  console.log('');
  const selectedSources = await checkbox<SourceType>({
    message: 'Which sources do you have access to?',
    choices: ALL_SOURCES.map((s) => ({
      value: s,
      name: SOURCE_META[s].label,
      description: SOURCE_META[s].description,
    })),
  });

  if (selectedSources.length === 0) {
    console.log(chalk.yellow('\n  No sources selected. You can add them later with:'));
    console.log(chalk.cyan('  argustack source add jira'));
    console.log(chalk.cyan('  argustack source add git'));
    console.log(chalk.cyan('  argustack source add github'));
    console.log(chalk.cyan('  argustack source add db'));

    const continueAnyway = await confirm({
      message: 'Create workspace without sources?',
      default: true,
    });
    if (!continueAnyway) {
      console.log(chalk.dim('  Cancelled.'));
      return;
    }
  }

  let jiraResult: JiraSetupResult | null = null;
  let gitResult: GitSetupResult | null = null;
  let githubResult: GitHubSetupResult | null = null;
  let csvResult: CsvSetupResult | null = null;
  let dbResult: DbSetupResult | null = null;

  for (const source of selectedSources) {
    switch (source) {
      case 'jira':   jiraResult = await setupJiraInteractive(); break;
      case 'git':    gitResult = await setupGitInteractive(); break;
      case 'github': githubResult = await setupGithubInteractive(gitResult?.githubToken, gitResult?.githubRepos); break;
      case 'csv':    csvResult = await setupCsvInteractive(); break;
      case 'db':     dbResult = await setupDbInteractive(); break;
    }
  }

  console.log('');
  console.log(chalk.dim('  Argustack internal database (Docker):'));

  const dbPortStr = await input({
    message: 'PostgreSQL port:', default: flags.dbPort ?? String(DEFAULT_DB_PORT),
    validate: (val): string | true => validatePort(val, 1024),
  });

  const pgwebPortStr = await input({
    message: 'pgweb UI port:', default: flags.pgwebPort ?? String(DEFAULT_PGWEB_PORT),
    validate: (val): string | true => validatePort(val, 1024),
  });

  const dbPort = parseInt(dbPortStr, 10);
  const pgwebPort = parseInt(pgwebPortStr, 10);

  const spinner = ora('Creating workspace...').start();
  try {
    createWorkspaceFiles(workspaceDir, jiraResult, gitResult, githubResult, csvResult, dbResult, dbPort, pgwebPort);
    spinner.succeed('Workspace created!');
  } catch (err: unknown) {
    spinner.fail('Failed to create workspace');
    console.log(chalk.red(`\n  Error: ${getErrorMsg(err)}`));
    return;
  }

  const autoStart = await confirm({
    message: 'Start database and sync now?',
    default: true,
  });

  printSummary(workspaceDir, jiraResult, gitResult, githubResult, csvResult, dbResult, pgwebPort, autoStart);

  if (autoStart) {
    await startAndSync(workspaceDir, jiraResult !== null, gitResult !== null, githubResult !== null, csvResult, pgwebPort);
  }
}

export async function runInit(flags: InitFlags = {}): Promise<void> {
  if (flags.interactive === false) {
    await runInitNonInteractive(flags);
  } else {
    await runInitInteractive(flags);
  }
}
