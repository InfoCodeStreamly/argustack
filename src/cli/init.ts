import { input, confirm, password, checkbox } from '@inquirer/prompts';
import { mkdirSync, writeFileSync, copyFileSync, existsSync, readdirSync } from 'node:fs';
import { execSync, spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import ora, { type Ora } from 'ora';
import { isWorkspace } from '../workspace/resolver.js';
import { createEmptyConfig, addSource, writeConfig } from '../workspace/config.js';
import { resolveServerPath } from './mcp-install.js';
import type { SourceType } from '../core/types/index.js';
import { SOURCE_META, ALL_SOURCES } from '../core/types/index.js';

const currentDir = fileURLToPath(new URL('.', import.meta.url));

function getTemplatesDir(): string {
  const templatesDir = resolve(currentDir, '..', '..', 'templates');
  if (!existsSync(templatesDir)) {
    throw new Error(`Templates directory not found: ${templatesDir}`);
  }
  return templatesDir;
}

interface JiraSetupResult {
  jiraUrl: string;
  jiraEmail: string;
  jiraToken: string;
  jiraProjects: string[];
}

interface GitSetupResult {
  gitRepoPaths: string[];
  githubToken?: string;
  githubRepos?: string[];
}

interface GitHubSetupResult {
  githubToken: string;
  githubOwner: string;
  githubRepo: string;
}

interface CsvSetupResult {
  csvFilePath: string;
}

interface DbSetupResult {
  targetDbHost: string;
  targetDbPort: number;
  targetDbUser: string;
  targetDbPassword: string;
  targetDbName: string;
}

/** CLI flags passed from commander */
export interface InitFlags {
  dir?: string;
  source?: string;          // comma-separated: "jira,git,github,db"
  jiraUrl?: string;
  jiraEmail?: string;
  jiraToken?: string;
  jiraProjects?: string;    // comma-separated or "all"
  gitRepo?: string;
  githubToken?: string;
  githubOwner?: string;
  githubRepo?: string;
  targetDbHost?: string;
  targetDbPort?: string;
  targetDbUser?: string;
  targetDbPassword?: string;
  targetDbName?: string;
  csvFile?: string;
  dbPort?: string;
  pgwebPort?: string;
  interactive?: boolean;    // --no-interactive sets this to false
}

/**
 * Strip path, query, fragment from a Jira URL.
 * User may paste full board URL like:
 *   https://team.atlassian.net/jira/software/c/projects/PAP/boards/43?search=462
 * We only need: https://team.atlassian.net
 */
function extractJiraBaseUrl(raw: string): string {
  try {
    const url = new URL(raw.trim());
    return `${url.protocol}//${url.host}`;
  } catch {
    return raw.trim().replace(/\/+$/, '');
  }
}

async function testJiraConnection(
  url: string, email: string, token: string,
): Promise<string[]> {
  const { Version3Client } = await import('jira.js');
  const client = new Version3Client({
    host: url,
    authentication: { basic: { email, apiToken: token } },
  });
  const result = await client.projects.searchProjects({ maxResults: 200 });
  return result.values.map((p) => p.key);
}

async function setupJiraInteractive(): Promise<JiraSetupResult | null> {
  console.log('');
  console.log(chalk.bold('  Jira setup'));
  console.log(chalk.dim('  Connect to your Jira instance.\n'));

  const jiraUrlRaw = await input({
    message: 'Jira URL:',
    default: 'https://your-team.atlassian.net',
    validate: (val): string | true => {
      if (!val.startsWith('https://')) {
        return 'Must start with https://';
      }
      return true;
    },
  });

  const jiraUrl = extractJiraBaseUrl(jiraUrlRaw);

  const jiraEmail = await input({
    message: 'Email:',
    validate: (val): string | true => {
      if (!val.includes('@')) {
        return 'Must be a valid email';
      }
      return true;
    },
  });

  let jiraToken: string;
  let availableProjects: string[];

  for (;;) {
    jiraToken = await password({
      message: 'API Token:',
      mask: '*',
      validate: (val): string | true => {
        if (!val.trim()) {
          return 'Token is required';
        }
        return true;
      },
    });

    const spinner = ora('Testing Jira connection...').start();

    try {
      availableProjects = await testJiraConnection(jiraUrl, jiraEmail, jiraToken);
    } catch (err: unknown) {
      spinner.fail('Connection failed');
      console.log(chalk.red(`  Error: ${err instanceof Error ? err.message : String(err)}`));
      console.log(chalk.dim('  Check URL, email, token. Generate token:'));
      console.log(chalk.dim('  https://id.atlassian.com/manage-profile/security/api-tokens'));

      const retry = await confirm({ message: 'Try again?', default: true });
      if (retry) {
        continue;
      }
      const skip = await confirm({ message: 'Skip Jira for now?', default: false });
      if (skip) {
        return null;
      }
      return setupJiraInteractive();
    }

    if (availableProjects.length === 0) {
      spinner.warn('Connected, but found 0 projects. Token may have limited permissions.');
      console.log(chalk.yellow('  Your token works but has no project access.'));
      console.log(chalk.dim('  This usually means the token was pasted incorrectly or has restricted scopes.'));

      const retry = await confirm({ message: 'Re-enter token?', default: true });
      if (retry) {
        continue;
      }
    } else {
      spinner.succeed(
        `Connected! Found ${availableProjects.length} projects: ${availableProjects.join(', ')}`
      );
    }

    break;
  }

  const jiraProjects = await checkbox<string>({
    message: 'Select projects to pull:',
    choices: availableProjects.map((key) => ({
      value: key,
      name: key,
    })),
  });

  if (jiraProjects.length === 0) {
    console.log(chalk.yellow('  No projects selected.'));
    return null;
  }

  return { jiraUrl, jiraEmail, jiraToken, jiraProjects };
}

function gitCloneWithProgress(url: string, targetPath: string, spinner: Ora): Promise<void> {
  return new Promise<void>((res, rej) => {
    const proc = spawn('git', ['clone', '--progress', url, targetPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: process.env['HOME'],
    });

    const repoName = url.split('/').pop()?.replace(/\.git$/, '') ?? 'repo';

    proc.stderr.on('data', (data: Buffer) => {
      const line = data.toString().trim();
      const match = /(\w[\w\s]+?):\s+(\d+)%\s+\((\d+)\/(\d+)\)/.exec(line);
      if (match) {
        const [, phase, pct] = match;
        spinner.text = `Cloning ${repoName}: ${phase?.trim()} ${pct}%`;
      }
    });

    proc.on('close', (code) => {
      if (code === 0) {
        res();
      } else {
        rej(new Error(`git clone exited with code ${String(code)}`));
      }
    });

    proc.on('error', rej);
  });
}

async function collectGitRepoLocal(): Promise<string | null> {
  const rawPath = await input({
    message: 'Path to local repo:',
    validate: (val): string | true => {
      const trimmed = val.trim();
      if (!trimmed) {
        return 'Path is required';
      }
      const resolved = resolve(trimmed.replace(/^~/, process.env['HOME'] ?? '~'));
      if (!existsSync(join(resolved, '.git'))) {
        return `Not a git repository: ${resolved} (no .git/ directory)`;
      }
      return true;
    },
  });
  return resolve(rawPath.trim().replace(/^~/, process.env['HOME'] ?? '~'));
}

async function collectGitRepoGithub(): Promise<{ paths: string[]; token: string; repos: string[] }> {
  const githubToken = await password({
    message: 'GitHub token (PAT):',
    mask: '*',
    validate: (val): string | true => {
      if (!val.trim()) {
        return 'Token is required';
      }
      return true;
    },
  });

  const spinner = ora('Fetching accessible repositories...').start();
  let repos: { full_name: string; clone_url: string; isPrivate: boolean; description: string | null }[];

  try {
    const { Octokit } = await import('octokit');
    const octokit = new Octokit({ auth: githubToken.trim() });
    const result = await octokit.rest.repos.listForAuthenticatedUser({
      per_page: 100,
      sort: 'updated',
      direction: 'desc',
    });
    repos = result.data.map((r) => ({
      full_name: r.full_name,
      clone_url: r.clone_url,
      isPrivate: r.private,
      description: r.description,
    }));
    spinner.succeed(`Found ${repos.length} repositories`);
  } catch (err: unknown) {
    spinner.fail('Failed to fetch repositories');
    console.log(chalk.red(`  Error: ${err instanceof Error ? err.message : String(err)}`));
    return { paths: [], token: githubToken.trim(), repos: [] };
  }

  if (repos.length === 0) {
    console.log(chalk.yellow('  No repositories accessible with this token.'));
    return { paths: [], token: githubToken.trim(), repos: [] };
  }

  const selectedRepos = await checkbox<{ cloneUrl: string; fullName: string }>({
    message: 'Select repositories to clone:',
    choices: repos.map((r) => ({
      value: { cloneUrl: r.clone_url, fullName: r.full_name },
      name: `${r.full_name} ${r.isPrivate ? '(private)' : '(public)'}`,
      ...(r.description ? { description: r.description } : {}),
    })),
  });

  if (selectedRepos.length === 0) {
    console.log(chalk.yellow('  No repositories selected.'));
    return { paths: [], token: githubToken.trim(), repos: [] };
  }

  const clonedPaths: string[] = [];
  const clonedRepos: string[] = [];
  for (const { cloneUrl, fullName } of selectedRepos) {
    const repoName = cloneUrl.split('/').pop()?.replace(/\.git$/, '') ?? 'repo';
    const defaultPath = resolve(repoName);
    const cloneDir = await input({
      message: `Clone ${repoName} into directory:`,
      default: defaultPath,
    });

    const targetPath = resolve(cloneDir.trim().replace(/^~/, process.env['HOME'] ?? '~'));
    const cloneSpinner = ora(`Cloning ${repoName}...`).start();

    try {
      await gitCloneWithProgress(cloneUrl, targetPath, cloneSpinner);
      cloneSpinner.succeed(`Cloned to ${targetPath}`);
      clonedPaths.push(targetPath);
      clonedRepos.push(fullName);
    } catch (err: unknown) {
      cloneSpinner.fail(`Failed to clone ${repoName}`);
      console.log(chalk.red(`  Error: ${err instanceof Error ? err.message : String(err)}`));
    }
  }

  return { paths: clonedPaths, token: githubToken.trim(), repos: clonedRepos };
}

async function collectGitRepoUrl(): Promise<string | null> {
  const repoUrl = await input({
    message: 'Repository URL (HTTPS):',
    validate: (val): string | true => {
      const trimmed = val.trim();
      if (!trimmed) {
        return 'URL is required';
      }
      if (!trimmed.startsWith('https://') && !trimmed.startsWith('git@')) {
        return 'Must start with https:// or git@';
      }
      return true;
    },
  });

  const defaultDir = repoUrl.trim().split('/').pop()?.replace(/\.git$/, '') ?? 'repo';
  const defaultPath = resolve(defaultDir);
  const cloneDir = await input({
    message: 'Clone into directory:',
    default: defaultPath,
  });

  const targetPath = resolve(cloneDir.trim().replace(/^~/, process.env['HOME'] ?? '~'));
  const spinner = ora(`Cloning ${repoUrl.trim()}...`).start();

  try {
    await gitCloneWithProgress(repoUrl.trim(), targetPath, spinner);
    spinner.succeed(`Cloned to ${targetPath}`);
    return targetPath;
  } catch (err: unknown) {
    spinner.fail('Clone failed');
    console.log(chalk.red(`  Error: ${err instanceof Error ? err.message : String(err)}`));
    console.log(chalk.dim('  Check URL and network. Make sure git is installed.'));
    return null;
  }
}

async function setupGitInteractive(): Promise<GitSetupResult | null> {
  console.log('');
  console.log(chalk.bold('  Git setup'));
  console.log(chalk.dim('  Connect to Git repositories.\n'));

  const { select } = await import('@inquirer/prompts');
  const gitRepoPaths: string[] = [];
  let savedGithubToken: string | undefined;
  const savedGithubRepos: string[] = [];

  let addMore = true;
  while (addMore) {
    const mode = await select<'local' | 'github' | 'clone'>({
      message: gitRepoPaths.length === 0
        ? 'Where is your Git repository?'
        : 'Add another Git repository:',
      choices: [
        {
          value: 'local' as const,
          name: 'Local path',
          description:
            'The repo is already downloaded to your computer. ' +
            'You just point to the folder where it lives (e.g. ~/projects/my-app). ' +
            'Nothing is downloaded — Argustack reads commit history directly from disk',
        },
        {
          value: 'github' as const,
          name: 'Clone from GitHub',
          description:
            'You have a GitHub account with access to the repo. ' +
            'Enter your GitHub token — Argustack will show all repos you have access to, ' +
            'you pick the ones you need, and they download automatically',
        },
        {
          value: 'clone' as const,
          name: 'Clone from URL',
          description:
            'You have a direct link to the repo (from GitHub, GitLab, Bitbucket, or any git server). ' +
            'Paste the URL and Argustack will download the repo for you. ' +
            'Use this if your repo is not on GitHub or you prefer to paste the link manually',
        },
      ],
    });

    if (mode === 'local') {
      const path = await collectGitRepoLocal();
      if (path) {
        gitRepoPaths.push(path);
      }
    } else if (mode === 'github') {
      const result = await collectGitRepoGithub();
      gitRepoPaths.push(...result.paths);
      savedGithubToken = result.token;
      savedGithubRepos.push(...result.repos);
    } else {
      const path = await collectGitRepoUrl();
      if (path) {
        gitRepoPaths.push(path);
      }
    }

    if (gitRepoPaths.length === 0) {
      const skip = await confirm({ message: 'Skip Git for now?', default: true });
      if (skip) {
        return null;
      }
      continue;
    }

    addMore = await confirm({ message: 'Add another Git repository?', default: false });
  }

  if (gitRepoPaths.length === 0) {
    return null;
  }

  for (const p of gitRepoPaths) {
    console.log(chalk.green(`  Git source configured: ${p}`));
  }

  return {
    gitRepoPaths,
    ...(savedGithubToken ? { githubToken: savedGithubToken } : {}),
    ...(savedGithubRepos.length > 0 ? { githubRepos: savedGithubRepos } : {}),
  };
}

async function setupGithubInteractive(
  existingToken?: string,
  existingRepos?: string[],
): Promise<GitHubSetupResult | null> {
  console.log('');
  console.log(chalk.bold('  GitHub setup'));
  console.log(chalk.dim('  Connect to GitHub API for PRs, reviews, and releases.\n'));

  if (existingToken && existingRepos && existingRepos.length > 0) {
    const repoToUse = existingRepos[0] ?? '';
    const [owner = '', repo = ''] = repoToUse.split('/');

    if (existingRepos.length === 1) {
      console.log(chalk.green(`  Auto-configured from Git step: ${repoToUse}`));
    } else {
      console.log(chalk.dim(`  Repos from Git step: ${existingRepos.join(', ')}`));
      console.log(chalk.green(`  Using first repo for GitHub PRs: ${repoToUse}`));
    }

    return {
      githubToken: existingToken.trim(),
      githubOwner: owner,
      githubRepo: repo,
    };
  }

  let githubToken: string;

  if (existingToken) {
    console.log(chalk.green('  Using GitHub token from Git clone step.'));
    githubToken = existingToken;
  } else {
    console.log(chalk.dim('  Generate token: Settings → Developer settings → Personal access tokens'));
    githubToken = await password({
      message: 'GitHub token (PAT):',
      mask: '*',
      validate: (val): string | true => {
        if (!val.trim()) {
          return 'Token is required';
        }
        return true;
      },
    });
  }

  const spinner = ora('Fetching accessible repositories...').start();
  let repos: { full_name: string; isPrivate: boolean; description: string | null }[];

  try {
    const { Octokit } = await import('octokit');
    const octokit = new Octokit({ auth: githubToken.trim() });
    const result = await octokit.rest.repos.listForAuthenticatedUser({
      per_page: 100,
      sort: 'updated',
      direction: 'desc',
    });
    repos = result.data.map((r) => ({
      full_name: r.full_name,
      isPrivate: r.private,
      description: r.description,
    }));
    spinner.succeed(`Found ${repos.length} accessible repositories`);
  } catch (err: unknown) {
    spinner.fail('Failed to fetch repositories');
    console.log(chalk.red(`  Error: ${err instanceof Error ? err.message : String(err)}`));
    console.log(chalk.dim('  You can add GitHub token to .env later.'));

    const skip = await confirm({ message: 'Skip GitHub for now?', default: true });
    if (skip) {
      return null;
    }
    return setupGithubInteractive(existingToken);
  }

  if (repos.length === 0) {
    console.log(chalk.yellow('  No repositories accessible with this token.'));
    console.log(chalk.dim('  Make sure the token has access to at least one repository.'));
    return null;
  }

  const { select } = await import('@inquirer/prompts');
  const selectedRepo = await select<string>({
    message: 'Select repository:',
    choices: repos.map((r) => ({
      value: r.full_name,
      name: `${r.full_name} ${r.isPrivate ? '(private)' : '(public)'}`,
      ...(r.description ? { description: r.description } : {}),
    })),
  });

  const [owner = '', repo = ''] = selectedRepo.split('/');
  console.log(chalk.green(`  GitHub configured: ${selectedRepo}`));

  return {
    githubToken: githubToken.trim(),
    githubOwner: owner,
    githubRepo: repo,
  };
}

async function setupCsvInteractive(): Promise<CsvSetupResult> {
  console.log('');
  console.log(chalk.bold('  Jira CSV Import setup'));
  console.log(chalk.dim('  Import issues from a Jira CSV export file.\n'));

  const cwd = process.cwd();
  const csvFiles = readdirSync(cwd).filter((f) => f.toLowerCase().endsWith('.csv'));

  let csvFilePath: string;

  if (csvFiles.length > 0) {
    const { select } = await import('@inquirer/prompts');
    const MANUAL_ENTRY = '__manual__';
    const selected = await select<string>({
      message: csvFiles.length === 1
        ? `Found CSV file in current directory:`
        : `Found ${csvFiles.length} CSV files in current directory:`,
      choices: [
        ...csvFiles.map((f) => ({ value: join(cwd, f), name: f })),
        { value: MANUAL_ENTRY, name: 'Enter path manually…' },
      ],
    });
    csvFilePath = selected === MANUAL_ENTRY ? await promptCsvPath() : selected;
  } else {
    csvFilePath = await promptCsvPath();
  }

  const resolved = resolve(csvFilePath);
  console.log(chalk.green(`  CSV file: ${resolved}`));

  return { csvFilePath: resolved };
}

async function promptCsvPath(): Promise<string> {
  const raw = await input({
    message: 'Path to Jira CSV file:',
    validate: (val): string | true => {
      if (!val.trim()) {
        return 'CSV file path is required';
      }
      return true;
    },
  });
  return resolve(raw.replace(/^~/, process.env['HOME'] ?? '~'));
}

async function setupDbInteractive(): Promise<DbSetupResult | null> {
  console.log('');
  console.log(chalk.bold('  Database setup'));
  console.log(chalk.dim('  Connect to the project database you want to analyze.\n'));
  console.log(chalk.dim('  (This is the TARGET database, not Argustack internal DB)\n'));

  const targetDbHost = await input({ message: 'DB Host:', default: 'localhost' });
  const targetDbPortStr = await input({
    message: 'DB Port:', default: '5432',
    validate: (val): string | true => {
      const n = parseInt(val, 10);
      if (isNaN(n) || n < 1 || n > 65535) {
        return 'Port must be 1-65535';
      }
      return true;
    },
  });
  const targetDbUser = await input({ message: 'DB User:' });
  const targetDbPassword = await password({ message: 'DB Password:' });
  const targetDbName = await input({ message: 'DB Name:' });

  const targetDbPort = parseInt(targetDbPortStr, 10);
  console.log(chalk.green(`  Database configured: ${targetDbUser}@${targetDbHost}:${targetDbPort}/${targetDbName}`));

  return { targetDbHost, targetDbPort, targetDbUser, targetDbPassword, targetDbName };
}

async function setupJiraFromFlags(flags: InitFlags): Promise<JiraSetupResult | null> {
  if (!flags.jiraUrl || !flags.jiraEmail || !flags.jiraToken) {
    throw new Error('Jira requires: --jira-url, --jira-email, --jira-token');
  }

  const spinner = ora('Testing Jira connection...').start();

  try {
    const availableProjects = await testJiraConnection(
      extractJiraBaseUrl(flags.jiraUrl), flags.jiraEmail, flags.jiraToken,
    );
    spinner.succeed(
      `Connected! Found ${availableProjects.length} projects: ${availableProjects.join(', ')}`
    );

    let jiraProjects: string[];
    if (!flags.jiraProjects || flags.jiraProjects.toLowerCase() === 'all') {
      jiraProjects = availableProjects;
    } else {
      jiraProjects = flags.jiraProjects.split(',').map((p) => p.trim().toUpperCase());
    }

    return {
      jiraUrl: flags.jiraUrl,
      jiraEmail: flags.jiraEmail,
      jiraToken: flags.jiraToken,
      jiraProjects,
    };
  } catch (err: unknown) {
    spinner.fail('Connection failed');
    throw new Error(`Jira connection failed: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }
}

function setupGitFromFlags(flags: InitFlags): GitSetupResult | null {
  if (!flags.gitRepo) {
    throw new Error('Git requires: --git-repo');
  }
  const paths = flags.gitRepo.split(',').map((p) => p.trim()).filter(Boolean);
  return { gitRepoPaths: paths };
}

function setupGithubFromFlags(flags: InitFlags): GitHubSetupResult | null {
  if (!flags.githubToken || !flags.githubOwner || !flags.githubRepo) {
    throw new Error('GitHub requires: --github-token, --github-owner, --github-repo');
  }
  return {
    githubToken: flags.githubToken,
    githubOwner: flags.githubOwner,
    githubRepo: flags.githubRepo,
  };
}

function setupDbFromFlags(flags: InitFlags): DbSetupResult | null {
  if (!flags.targetDbHost || !flags.targetDbUser || !flags.targetDbName) {
    throw new Error('Database requires: --target-db-host, --target-db-user, --target-db-name');
  }
  return {
    targetDbHost: flags.targetDbHost,
    targetDbPort: parseInt(flags.targetDbPort ?? '5432', 10),
    targetDbUser: flags.targetDbUser,
    targetDbPassword: flags.targetDbPassword ?? '',
    targetDbName: flags.targetDbName,
  };
}

function setupCsvFromFlags(flags: InitFlags): CsvSetupResult | null {
  if (!flags.csvFile) {
    throw new Error('CSV requires: --csv-file');
  }
  return { csvFilePath: flags.csvFile };
}

function generateEnv(
  jira: JiraSetupResult | null,
  git: GitSetupResult | null,
  github: GitHubSetupResult | null,
  csv: CsvSetupResult | null,
  db: DbSetupResult | null,
  argustackDbPort: number,
): string {
  const lines: string[] = [];

  if (jira) {
    lines.push(
      '# === Jira ===',
      `JIRA_URL=${jira.jiraUrl}`,
      `JIRA_EMAIL=${jira.jiraEmail}`,
      `JIRA_API_TOKEN=${jira.jiraToken}`,
      `JIRA_PROJECTS=${jira.jiraProjects.join(',')}`,
      '',
    );
  }

  if (git) {
    lines.push(
      '# === Git ===',
      `GIT_REPO_PATHS=${git.gitRepoPaths.join(',')}`,
      '',
    );
  }

  if (github) {
    lines.push(
      '# === GitHub ===',
      `GITHUB_TOKEN=${github.githubToken}`,
      `GITHUB_OWNER=${github.githubOwner}`,
      `GITHUB_REPO=${github.githubRepo}`,
      '',
    );
  }

  if (csv) {
    lines.push(
      '# === Jira CSV ===',
      `CSV_FILE_PATH=${csv.csvFilePath}`,
      '',
    );
  }

  if (db) {
    lines.push(
      '# === Target Database (project DB to analyze) ===',
      `TARGET_DB_HOST=${db.targetDbHost}`,
      `TARGET_DB_PORT=${db.targetDbPort}`,
      `TARGET_DB_USER=${db.targetDbUser}`,
      `TARGET_DB_PASSWORD=${db.targetDbPassword}`,
      `TARGET_DB_NAME=${db.targetDbName}`,
      '',
    );
  }

  lines.push(
    '# === Argustack internal PostgreSQL (match docker-compose.yml) ===',
    'DB_HOST=localhost',
    `DB_PORT=${argustackDbPort}`,
    'DB_USER=argustack',
    'DB_PASSWORD=argustack_local',
    'DB_NAME=argustack',
    '',
    '# === OpenAI embeddings (optional, for semantic search) ===',
    '# OPENAI_API_KEY=sk-...',
  );

  return lines.join('\n') + '\n';
}

function generateDockerCompose(dbPort: number, pgwebPort: number): string {
  return `services:
  db:
    image: pgvector/pgvector:pg16
    container_name: argustack-db
    ports:
      - "${dbPort}:5432"
    environment:
      POSTGRES_USER: argustack
      POSTGRES_PASSWORD: argustack_local
      POSTGRES_DB: argustack
    volumes:
      - argustack-data:/var/lib/postgresql/data
      - ./db/init.sql:/docker-entrypoint-initdb.d/init.sql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U argustack"]
      interval: 2s
      timeout: 5s
      retries: 15

  pgweb:
    image: sosedoff/pgweb
    container_name: argustack-pgweb
    ports:
      - "${pgwebPort}:8081"
    environment:
      PGWEB_DATABASE_URL: postgres://argustack:argustack_local@db:5432/argustack?sslmode=disable
    depends_on:
      db:
        condition: service_healthy
    restart: on-failure

volumes:
  argustack-data:
`;
}

function createWorkspaceFiles(
  workspaceDir: string,
  jira: JiraSetupResult | null,
  git: GitSetupResult | null,
  github: GitHubSetupResult | null,
  csv: CsvSetupResult | null,
  db: DbSetupResult | null,
  dbPort: number,
  pgwebPort: number,
): void {
  const templatesDir = getTemplatesDir();

  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(join(workspaceDir, '.argustack'), { recursive: true });
  mkdirSync(join(workspaceDir, 'db'), { recursive: true });
  mkdirSync(join(workspaceDir, 'data'), { recursive: true });

  let config = createEmptyConfig();
  if (jira) {
    config = addSource(config, 'jira');
  }
  if (git) {
    config = addSource(config, 'git');
  }
  if (github) {
    config = addSource(config, 'github');
  }
  if (csv) {
    config = addSource(config, 'csv');
  }
  if (db) {
    config = addSource(config, 'db');
  }
  writeConfig(workspaceDir, config);

  writeFileSync(join(workspaceDir, '.env'), generateEnv(jira, git, github, csv, db, dbPort));

  writeFileSync(join(workspaceDir, 'docker-compose.yml'), generateDockerCompose(dbPort, pgwebPort));

  copyFileSync(join(templatesDir, 'init.sql'), join(workspaceDir, 'db', 'init.sql'));

  copyFileSync(join(templatesDir, 'gitignore'), join(workspaceDir, '.gitignore'));

  try {
    const serverPath = resolveServerPath();
    const mcpConfig = {
      mcpServers: {
        argustack: {
          command: 'node',
          args: [serverPath],
        },
      },
    };
    writeFileSync(
      join(workspaceDir, '.mcp.json'),
      JSON.stringify(mcpConfig, null, 2) + '\n',
    );
  } catch { /* optional file, ignore */ }
}

function printSummary(
  workspaceDir: string,
  jira: JiraSetupResult | null,
  git: GitSetupResult | null,
  github: GitHubSetupResult | null,
  csv: CsvSetupResult | null,
  db: DbSetupResult | null,
  pgwebPort: number,
  willAutoStart: boolean,
): void {
  console.log('');
  console.log(chalk.green.bold('  Done! Your workspace is ready.'));
  console.log('');

  console.log(chalk.dim('  Sources configured:'));
  if (jira) {
    console.log(`    ${chalk.green('✓')} Jira — ${jira.jiraUrl}`);
  }
  if (git) {
    for (const p of git.gitRepoPaths) {
      console.log(`    ${chalk.green('✓')} Git — ${p}`);
    }
  }
  if (github) {
    console.log(`    ${chalk.green('✓')} GitHub — ${github.githubOwner}/${github.githubRepo}`);
  }
  if (csv) {
    console.log(`    ${chalk.green('✓')} Jira CSV — ${csv.csvFilePath}`);
  }
  if (db) {
    console.log(`    ${chalk.green('✓')} Database — ${db.targetDbHost}:${db.targetDbPort}`);
  }
  if (!jira && !git && !github && !csv && !db) {
    console.log(`    ${chalk.yellow('—')} None yet. Use ${chalk.cyan('argustack source add <type>')}`);
  }

  if (!willAutoStart) {
    console.log('');
    console.log(chalk.dim('  Next steps:'));
    console.log(`  ${chalk.cyan('cd')} ${workspaceDir}`);
    console.log(`  ${chalk.cyan('docker compose up -d')}          # start database`);
    if (jira) {
      console.log(`  ${chalk.cyan('argustack sync jira')}            # sync from Jira`);
    }
    console.log(`  ${chalk.cyan(`http://localhost:${pgwebPort}`)}            # browse data in pgweb`);

    console.log('');
    console.log(chalk.dim('  Claude integration:'));
    console.log(`    Claude Code:    ${chalk.green('Open this folder — MCP tools ready!')}`);
    console.log(`    Claude Desktop: ${chalk.cyan('argustack mcp install')}`);
  }

  console.log('');
}

async function runInitNonInteractive(flags: InitFlags): Promise<void> {
  console.log(chalk.bold('\n  Argustack — non-interactive setup\n'));

  const workspaceDir = resolve(
    (flags.dir ?? process.cwd()).replace(/^~/, process.env['HOME'] ?? '~')
  );

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

  const dbPort = parseInt(flags.dbPort ?? '5434', 10);
  const pgwebPort = parseInt(flags.pgwebPort ?? '8086', 10);

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

  const workspaceDir = resolve(targetDir.replace(/^~/, process.env['HOME'] ?? '~'));

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
    message: 'PostgreSQL port:', default: flags.dbPort ?? '5434',
    validate: (val): string | true => {
      const n = parseInt(val, 10);
      if (isNaN(n) || n < 1024 || n > 65535) {
        return 'Port must be 1024-65535';
      }
      return true;
    },
  });

  const pgwebPortStr = await input({
    message: 'pgweb UI port:', default: flags.pgwebPort ?? '8086',
    validate: (val): string | true => {
      const n = parseInt(val, 10);
      if (isNaN(n) || n < 1024 || n > 65535) {
        return 'Port must be 1024-65535';
      }
      return true;
    },
  });

  const dbPort = parseInt(dbPortStr, 10);
  const pgwebPort = parseInt(pgwebPortStr, 10);

  const spinner = ora('Creating workspace...').start();
  try {
    createWorkspaceFiles(workspaceDir, jiraResult, gitResult, githubResult, csvResult, dbResult, dbPort, pgwebPort);
    spinner.succeed('Workspace created!');
  } catch (err: unknown) {
    spinner.fail('Failed to create workspace');
    console.log(chalk.red(`\n  Error: ${err instanceof Error ? err.message : String(err)}`));
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

async function startAndSync(workspaceDir: string, hasJira: boolean, hasGit: boolean, hasGithub: boolean, csv: CsvSetupResult | null, pgwebPort: number): Promise<void> {
  const spinnerDb = ora('Starting Docker containers...').start();
  try {
    execSync('docker compose up -d', { cwd: workspaceDir, stdio: 'pipe' });
    spinnerDb.succeed('Database running!');
  } catch (err: unknown) {
    spinnerDb.fail('Failed to start Docker');
    console.log(chalk.red(`  Error: ${err instanceof Error ? err.message : String(err)}`));
    console.log(chalk.dim('  Make sure Docker Desktop is running, then:'));
    console.log(chalk.cyan(`  cd ${workspaceDir} && docker compose up -d`));
    return;
  }

  const spinnerWait = ora('Waiting for PostgreSQL...').start();
  const maxWait = 30;
  for (let i = 0; i < maxWait; i++) {
    try {
      execSync(
        'docker compose exec -T db pg_isready -U argustack',
        { cwd: workspaceDir, stdio: 'pipe' },
      );
      spinnerWait.succeed('PostgreSQL ready!');
      break;
    } catch {
      if (i === maxWait - 1) {
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
      const { syncJiraFromInit } = await import('./sync.js');
      await syncJiraFromInit(workspaceDir);
    } catch (err: unknown) {
      console.log(chalk.red(`  Jira sync failed: ${err instanceof Error ? err.message : String(err)}`));
      console.log(chalk.dim(`  Try manually: cd ${workspaceDir} && argustack sync jira`));
    }
  }

  if (hasGit) {
    console.log('');
    try {
      const { syncGitFromInit } = await import('./sync.js');
      await syncGitFromInit(workspaceDir);
    } catch (err: unknown) {
      console.log(chalk.red(`  Git sync failed: ${err instanceof Error ? err.message : String(err)}`));
      console.log(chalk.dim(`  Try manually: cd ${workspaceDir} && argustack sync git`));
    }
  }

  if (hasGithub) {
    console.log('');
    try {
      const { syncGithubFromInit } = await import('./sync.js');
      await syncGithubFromInit(workspaceDir);
    } catch (err: unknown) {
      console.log(chalk.red(`  GitHub sync failed: ${err instanceof Error ? err.message : String(err)}`));
      console.log(chalk.dim(`  Try manually: cd ${workspaceDir} && argustack sync github`));
    }
  }

  if (csv) {
    console.log('');
    try {
      const { syncCsvFromInit } = await import('./sync.js');
      await syncCsvFromInit(workspaceDir, csv.csvFilePath);
    } catch (err: unknown) {
      console.log(chalk.red(`  CSV import failed: ${err instanceof Error ? err.message : String(err)}`));
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

export async function runInit(flags: InitFlags = {}): Promise<void> {
  if (flags.interactive === false) {
    await runInitNonInteractive(flags);
  } else {
    await runInitInteractive(flags);
  }
}
