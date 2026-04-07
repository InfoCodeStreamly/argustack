import { readdirSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { input, confirm, checkbox, select } from '@inquirer/prompts';
import { execSync } from 'node:child_process';
import chalk from 'chalk';
import ora from 'ora';
import { isWorkspace } from '../../workspace/resolver.js';
import { readConfig } from '../../workspace/config.js';
import type { SourceType, WorkspaceConfig } from '../../core/types/index.js';
import { ALL_SOURCES, SOURCE_META } from '../../core/types/index.js';
import type {
  InitFlags,
  JiraSetupResult,
  GitSetupResult,
  GitHubSetupResult,
  CsvSetupResult,
  DbSetupResult,
  ProxySetupResult,
} from './types.js';
import { DEFAULT_DB_PORT, DEFAULT_PGWEB_PORT, validatePort, getErrorMsg, findAvailablePort } from './types.js';
import { setupJiraInteractive, setupJiraFromFlags } from './setup-jira.js';
import { setupGitInteractive, setupGitFromFlags } from './setup-git.js';
import { setupGithubInteractive, setupGithubFromFlags } from './setup-github.js';
import { setupCsvInteractive, setupCsvFromFlags } from './setup-csv.js';
import { setupDbInteractive, setupDbFromFlags } from './setup-db.js';
import { createWorkspaceFiles, printSummary } from './generators.js';

export type { InitFlags } from './types.js';

interface WorkspaceInfo {
  name: string;
  path: string;
  config: WorkspaceConfig;
}

/**
 * Scan directory for existing workspace subdirectories.
 */
export function scanWorkspaces(dir: string): WorkspaceInfo[] {
  const resolved = resolve(dir);
  const workspaces: WorkspaceInfo[] = [];

  let entries: string[];
  try {
    entries = readdirSync(resolved);
  } catch {
    return [];
  }

  for (const name of entries) {
    if (name.startsWith('.')) {
      continue;
    }

    const subdir = join(resolved, name);
    if (isWorkspace(subdir)) {
      const config = readConfig(subdir);
      if (config) {
        workspaces.push({
          name: config.name ?? name,
          path: subdir,
          config,
        });
      }
    }
  }

  return workspaces;
}

/**
 * Sanitize workspace name to kebab-case directory name.
 */
function sanitizeName(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Find next available port by checking existing docker-compose files.
 */

async function startAndSync(
  workspaceDir: string,
  hasJira: boolean,
  hasGit: boolean,
  hasGithub: boolean,
  csv: CsvSetupResult | null,
  db: DbSetupResult | null,
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

  if (db) {
    console.log('');
    try {
      const { syncDbFromInit } = await import('../sync.js');
      await syncDbFromInit(workspaceDir);
    } catch (err: unknown) {
      console.log(chalk.red(`  Database sync failed: ${getErrorMsg(err)}`));
      console.log(chalk.dim(`  Try manually: cd ${workspaceDir} && argustack sync db`));
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

async function setupSources(flags: InitFlags): Promise<{
  jira: JiraSetupResult | null;
  proxy: ProxySetupResult | null;
  git: GitSetupResult | null;
  github: GitHubSetupResult | null;
  csv: CsvSetupResult | null;
  db: DbSetupResult | null;
}> {
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

    const continueAnyway = await confirm({
      message: 'Create workspace without sources?',
      default: true,
    });
    if (!continueAnyway) {
      throw new Error('Cancelled');
    }
  }

  let jira: JiraSetupResult | null = null;
  let proxy: ProxySetupResult | null = null;
  let git: GitSetupResult | null = null;
  let github: GitHubSetupResult | null = null;
  let csv: CsvSetupResult | null = null;
  let db: DbSetupResult | null = null;

  for (const source of selectedSources) {
    switch (source) {
      case 'jira': {
        const result = await setupJiraInteractive();
        jira = result.jira;
        proxy = result.proxy;
        break;
      }
      case 'git':    git = await setupGitInteractive(); break;
      case 'github': github = await setupGithubInteractive(git?.githubToken, git?.githubRepos); break;
      case 'csv':    csv = await setupCsvInteractive(); break;
      case 'db':     db = await setupDbInteractive(); break;
      case 'board':  break;
    }
  }

  void flags;
  return { jira, proxy, git, github, csv, db };
}

async function runInitNonInteractive(flags: InitFlags): Promise<void> {
  console.log(chalk.bold('\n  Argustack — non-interactive setup\n'));

  if (!flags.name) {
    throw new Error('Workspace name is required. Usage: argustack init <name>');
  }

  const workspaceName = sanitizeName(flags.name);
  const workspaceDir = resolve(process.cwd(), workspaceName);

  if (isWorkspace(workspaceDir)) {
    throw new Error(`Workspace '${workspaceName}' already exists at ${workspaceDir}`);
  }

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
      case 'board':
        break;
    }
  }

  const dbPort = flags.dbPort
    ? parseInt(flags.dbPort, 10)
    : await findAvailablePort(DEFAULT_DB_PORT);
  const pgwebPort = flags.pgwebPort
    ? parseInt(flags.pgwebPort, 10)
    : await findAvailablePort(DEFAULT_PGWEB_PORT);

  const spinner = ora('Creating workspace...').start();
  try {
    createWorkspaceFiles(workspaceDir, jiraResult, gitResult, githubResult, csvResult, dbResult, dbPort, pgwebPort, workspaceName, null);
    spinner.succeed(`Workspace '${workspaceName}' created!`);
  } catch (err: unknown) {
    spinner.fail('Failed');
    throw err;
  }

  printSummary(workspaceDir, jiraResult, gitResult, githubResult, csvResult, dbResult, pgwebPort, false, null);
}

async function runInitInteractive(flags: InitFlags): Promise<void> {
  console.log('');
  console.log(chalk.bold('  Argustack — workspace setup'));
  console.log(chalk.dim('  Cross-reference Jira + Git + DB to analyze your project.\n'));

  const cwd = process.cwd();
  const existing = scanWorkspaces(cwd);

  let workspaceName: string;
  let workspaceDir: string;

  if (existing.length > 0) {
    console.log(chalk.dim(`  Found ${String(existing.length)} workspace(s) in ${basename(cwd)}:`));
    for (const ws of existing) {
      const sources = ws.config.order.length > 0
        ? ws.config.order.map((s) => SOURCE_META[s].label).join(', ')
        : 'no sources';
      console.log(`    ${chalk.green('●')} ${chalk.bold(ws.name)} — ${chalk.dim(sources)}`);
    }
    console.log('');

    const action = await select({
      message: 'What would you like to do?',
      choices: [
        { value: 'new', name: 'Create new workspace' },
        ...existing.map((ws) => ({
          value: `update:${ws.name}`,
          name: `Update ${ws.name}`,
        })),
      ],
    });

    if (action.startsWith('update:')) {
      const updateName = action.slice('update:'.length);
      const ws = existing.find((w) => w.name === updateName);
      if (!ws) {
        throw new Error(`Workspace '${updateName}' not found`);
      }
      console.log(chalk.dim(`\n  Updating workspace: ${updateName}\n`));
      workspaceName = updateName;
      workspaceDir = ws.path;
    } else {
      const rawName = flags.name ?? await input({
        message: 'Workspace name:',
        validate: (val): string | true => {
          if (val.includes('://') || val.includes('.') || val.includes('/')) {
            return 'This looks like a URL. Enter a short project name (e.g. "paperlink", "my-project")';
          }
          const sanitized = sanitizeName(val);
          if (!sanitized) {
            return 'Name is required (letters, numbers, hyphens)';
          }
          if (sanitized.length > 30) {
            return 'Name too long — keep it under 30 characters';
          }
          if (existing.some((ws) => ws.name === sanitized)) {
            return `Workspace '${sanitized}' already exists`;
          }
          return true;
        },
      });

      workspaceName = sanitizeName(rawName);
      workspaceDir = join(cwd, workspaceName);
    }
  } else {
    const rawName = flags.name ?? await input({
      message: 'Workspace name:',
      validate: (val): string | true => {
        if (val.includes('://') || val.includes('.') || val.includes('/')) {
          return 'This looks like a URL. Enter a short project name (e.g. "paperlink", "my-project")';
        }
        const sanitized = sanitizeName(val);
        if (!sanitized) {
          return 'Name is required (letters, numbers, hyphens)';
        }
        if (sanitized.length > 30) {
          return 'Name too long — keep it under 30 characters';
        }
        return true;
      },
    });

    workspaceName = sanitizeName(rawName);
    workspaceDir = join(cwd, workspaceName);
  }

  if (isWorkspace(workspaceDir)) {
    console.log(chalk.yellow(`\n  Workspace '${workspaceName}' already exists.`));
    const proceed = await confirm({ message: 'Reinitialize this workspace?', default: false });
    if (!proceed) {
      console.log(chalk.dim('  Cancelled.'));
      return;
    }
  }

  process.env['ARGUSTACK_INIT_WORKSPACE'] = workspaceName;
  const { jira, proxy, git, github, csv, db } = await setupSources(flags);
  delete process.env['ARGUSTACK_INIT_WORKSPACE'];

  console.log('');
  console.log(chalk.dim('  Argustack internal database (Docker):'));

  const defaultDbPort = await findAvailablePort(DEFAULT_DB_PORT);
  const defaultPgwebPort = await findAvailablePort(DEFAULT_PGWEB_PORT);

  const dbPortStr = await input({
    message: 'PostgreSQL port:', default: flags.dbPort ?? String(defaultDbPort),
    validate: (val): string | true => validatePort(val, 1024),
  });

  const pgwebPortStr = await input({
    message: 'pgweb UI port:', default: flags.pgwebPort ?? String(defaultPgwebPort),
    validate: (val): string | true => validatePort(val, 1024),
  });

  const dbPort = parseInt(dbPortStr, 10);
  const pgwebPort = parseInt(pgwebPortStr, 10);

  const spinner = ora('Creating workspace...').start();
  try {
    createWorkspaceFiles(workspaceDir, jira, git, github, csv, db, dbPort, pgwebPort, workspaceName, proxy);
    spinner.succeed(`Workspace '${workspaceName}' created!`);
  } catch (err: unknown) {
    spinner.fail('Failed to create workspace');
    console.log(chalk.red(`\n  Error: ${getErrorMsg(err)}`));
    return;
  }

  const autoStart = await confirm({
    message: 'Start database and sync now?',
    default: true,
  });

  printSummary(workspaceDir, jira, git, github, csv, db, pgwebPort, autoStart, proxy);

  if (autoStart) {
    await startAndSync(workspaceDir, jira !== null || proxy !== null, git !== null, github !== null, csv, db, pgwebPort);
  }
}

export async function runInit(flags: InitFlags = {}): Promise<void> {
  if (flags.interactive === false) {
    await runInitNonInteractive(flags);
  } else {
    await runInitInteractive(flags);
  }
}
