import { input, confirm, password, checkbox } from '@inquirer/prompts';
import { mkdirSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import ora from 'ora';
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

// ─── Types ───────────────────────────────────────────────────────────────────

interface JiraSetupResult {
  jiraUrl: string;
  jiraEmail: string;
  jiraToken: string;
  jiraProjects: string[];
}

interface GitSetupResult {
  gitRepoPath: string;
  githubToken?: string | undefined;
  githubOwner?: string | undefined;
  githubRepo?: string | undefined;
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
  source?: string;          // comma-separated: "jira,git,db"
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

// ─── Jira connection test (shared between interactive and non-interactive) ───

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

// ─── Interactive source setup ────────────────────────────────────────────────

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

  const projectsInput = await input({
    message: 'Projects to pull (comma-separated, or "all"):',
    default: availableProjects.length > 0 ? 'all' : '',
  });

  const jiraProjects =
    projectsInput.trim().toLowerCase() === 'all'
      ? availableProjects
      : projectsInput.split(',').map((p) => p.trim().toUpperCase());

  return { jiraUrl, jiraEmail, jiraToken, jiraProjects };
}

async function setupGitInteractive(): Promise<GitSetupResult | null> {
  console.log('');
  console.log(chalk.bold('  Git setup'));
  console.log(chalk.dim('  Connect to a Git repository.\n'));

  const { select } = await import('@inquirer/prompts');

  const mode = await select<'local' | 'clone'>({
    message: 'Where is your Git repository?',
    choices: [
      { value: 'local' as const, name: 'Local path — already cloned on this machine' },
      { value: 'clone' as const, name: 'Clone from URL — download from GitHub/GitLab/etc.' },
    ],
  });

  let gitRepoPath: string;

  if (mode === 'local') {
    gitRepoPath = await input({
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
    gitRepoPath = resolve(gitRepoPath.trim().replace(/^~/, process.env['HOME'] ?? '~'));
  } else {
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
    const cloneDir = await input({
      message: 'Clone into directory:',
      default: defaultDir,
    });

    const targetPath = resolve(cloneDir.trim());
    const spinner = ora(`Cloning ${repoUrl.trim()}...`).start();

    try {
      execSync(`git clone ${repoUrl.trim()} ${targetPath}`, { stdio: 'pipe' });
      spinner.succeed(`Cloned to ${targetPath}`);
      gitRepoPath = targetPath;
    } catch (err: unknown) {
      spinner.fail('Clone failed');
      console.log(chalk.red(`  Error: ${err instanceof Error ? err.message : String(err)}`));
      console.log(chalk.dim('  Check URL and network. Make sure git is installed.'));

      const retry = await confirm({ message: 'Try again?', default: true });
      if (retry) {
        return setupGitInteractive();
      }

      const skip = await confirm({ message: 'Skip Git for now?', default: false });
      if (skip) {
        return null;
      }
      return setupGitInteractive();
    }
  }

  console.log(chalk.green(`  Git source configured: ${gitRepoPath}`));

  // GitHub API (optional)
  const hasGithub = await confirm({
    message: 'Connect to GitHub API? (PRs, reviews, releases)',
    default: false,
  });

  if (hasGithub) {
    console.log(chalk.dim('  Generate token: Settings → Developer settings → Personal access tokens'));

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

    const githubOwner = await input({
      message: 'Repository owner (org or user):',
      validate: (val): string | true => {
        if (!val.trim()) {
          return 'Owner is required';
        }
        return true;
      },
    });

    const githubRepo = await input({
      message: 'Repository name:',
      validate: (val): string | true => {
        if (!val.trim()) {
          return 'Repo name is required';
        }
        return true;
      },
    });

    // Test connection
    const spinner = ora('Testing GitHub connection...').start();
    try {
      const { Octokit } = await import('octokit');
      const octokit = new Octokit({ auth: githubToken.trim() });
      const { data: repo } = await octokit.rest.repos.get({
        owner: githubOwner.trim(),
        repo: githubRepo.trim(),
      });
      spinner.succeed(`Connected! ${repo.full_name} (${repo.private ? 'private' : 'public'})`);
    } catch (err: unknown) {
      spinner.fail('GitHub connection failed');
      console.log(chalk.red(`  Error: ${err instanceof Error ? err.message : String(err)}`));
      console.log(chalk.dim('  PRs/reviews won\'t be synced. You can add GitHub token to .env later.'));
      return { gitRepoPath };
    }

    return {
      gitRepoPath,
      githubToken: githubToken.trim(),
      githubOwner: githubOwner.trim(),
      githubRepo: githubRepo.trim(),
    };
  }

  return { gitRepoPath };
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

// ─── Non-interactive source setup (from flags) ──────────────────────────────

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
  return {
    gitRepoPath: flags.gitRepo,
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

// ─── .env generation ─────────────────────────────────────────────────────────

function generateEnv(
  jira: JiraSetupResult | null,
  git: GitSetupResult | null,
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
      `GIT_REPO_PATH=${git.gitRepoPath}`,
    );
    if (git.githubToken && git.githubOwner && git.githubRepo) {
      lines.push(
        `GITHUB_TOKEN=${git.githubToken}`,
        `GITHUB_OWNER=${git.githubOwner}`,
        `GITHUB_REPO=${git.githubRepo}`,
      );
    }
    lines.push('');
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

// ─── docker-compose generation ───────────────────────────────────────────────

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

// ─── Create workspace (shared logic) ─────────────────────────────────────────

function createWorkspaceFiles(
  workspaceDir: string,
  jira: JiraSetupResult | null,
  git: GitSetupResult | null,
  db: DbSetupResult | null,
  dbPort: number,
  pgwebPort: number,
): void {
  const templatesDir = getTemplatesDir();

  // Directories
  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(join(workspaceDir, '.argustack'), { recursive: true });
  mkdirSync(join(workspaceDir, 'db'), { recursive: true });
  mkdirSync(join(workspaceDir, 'data'), { recursive: true });

  // Config
  let config = createEmptyConfig();
  if (jira) {
    config = addSource(config, 'jira');
  }
  if (git) {
    config = addSource(config, 'git');
  }
  if (db) {
    config = addSource(config, 'db');
  }
  writeConfig(workspaceDir, config);

  // .env
  writeFileSync(join(workspaceDir, '.env'), generateEnv(jira, git, db, dbPort));

  // docker-compose.yml
  writeFileSync(join(workspaceDir, 'docker-compose.yml'), generateDockerCompose(dbPort, pgwebPort));

  // init.sql
  copyFileSync(join(templatesDir, 'init.sql'), join(workspaceDir, 'db', 'init.sql'));

  // .gitignore
  copyFileSync(join(templatesDir, 'gitignore'), join(workspaceDir, '.gitignore'));

  // .mcp.json — Claude Code auto-discovers MCP servers from this file
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
  } catch {
    // Server not built yet — skip .mcp.json, user can run `argustack mcp install` later
  }
}

// ─── Summary output ──────────────────────────────────────────────────────────

function printSummary(
  workspaceDir: string,
  jira: JiraSetupResult | null,
  git: GitSetupResult | null,
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
    console.log(`    ${chalk.green('✓')} Git — ${git.gitRepoPath}`);
  }
  if (db) {
    console.log(`    ${chalk.green('✓')} Database — ${db.targetDbHost}:${db.targetDbPort}`);
  }
  if (!jira && !git && !db) {
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

// ─── Non-interactive init ────────────────────────────────────────────────────

async function runInitNonInteractive(flags: InitFlags): Promise<void> {
  console.log(chalk.bold('\n  Argustack — non-interactive setup\n'));

  // Workspace dir
  const workspaceDir = resolve(
    (flags.dir ?? process.cwd()).replace(/^~/, process.env['HOME'] ?? '~')
  );

  // Parse sources
  const selectedSources: SourceType[] = flags.source
    ? (flags.source.split(',').map((s) => s.trim().toLowerCase()) as SourceType[])
    : [];

  // Validate source names
  for (const s of selectedSources) {
    if (!ALL_SOURCES.includes(s)) {
      throw new Error(`Unknown source: ${s}. Available: ${ALL_SOURCES.join(', ')}`);
    }
  }

  // Setup each source from flags
  let jiraResult: JiraSetupResult | null = null;
  let gitResult: GitSetupResult | null = null;
  let dbResult: DbSetupResult | null = null;

  for (const source of selectedSources) {
    switch (source) {
      case 'jira':
        jiraResult = await setupJiraFromFlags(flags);
        break;
      case 'git':
        gitResult = setupGitFromFlags(flags);
        break;
      case 'db':
        dbResult = setupDbFromFlags(flags);
        break;
    }
  }

  const dbPort = parseInt(flags.dbPort ?? '5434', 10);
  const pgwebPort = parseInt(flags.pgwebPort ?? '8086', 10);

  // Create workspace
  const spinner = ora('Creating workspace...').start();
  try {
    createWorkspaceFiles(workspaceDir, jiraResult, gitResult, dbResult, dbPort, pgwebPort);
    spinner.succeed('Workspace created!');
  } catch (err: unknown) {
    spinner.fail('Failed');
    throw err;
  }

  printSummary(workspaceDir, jiraResult, gitResult, dbResult, pgwebPort, false);
}

// ─── Interactive init ────────────────────────────────────────────────────────

async function runInitInteractive(flags: InitFlags): Promise<void> {
  console.log('');
  console.log(chalk.bold('  Argustack — workspace setup'));
  console.log(chalk.dim('  Cross-reference Jira + Git + DB to analyze your project.\n'));

  // 1. Where to create?
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

  // 2. Which sources?
  console.log('');
  const selectedSources = await checkbox<SourceType>({
    message: 'Which sources do you have access to?',
    choices: ALL_SOURCES.map((s) => ({
      value: s,
      name: `${SOURCE_META[s].label} — ${SOURCE_META[s].description}`,
    })),
  });

  if (selectedSources.length === 0) {
    console.log(chalk.yellow('\n  No sources selected. You can add them later with:'));
    console.log(chalk.cyan('  argustack source add jira'));
    console.log(chalk.cyan('  argustack source add git'));
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

  // 3. Collect credentials for each selected source
  let jiraResult: JiraSetupResult | null = null;
  let gitResult: GitSetupResult | null = null;
  let dbResult: DbSetupResult | null = null;

  for (const source of selectedSources) {
    switch (source) {
      case 'jira': jiraResult = await setupJiraInteractive(); break;
      case 'git':  gitResult = await setupGitInteractive(); break;
      case 'db':   dbResult = await setupDbInteractive(); break;
    }
  }

  // 4. Argustack internal DB ports
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

  // 5. Create workspace
  const spinner = ora('Creating workspace...').start();
  try {
    createWorkspaceFiles(workspaceDir, jiraResult, gitResult, dbResult, dbPort, pgwebPort);
    spinner.succeed('Workspace created!');
  } catch (err: unknown) {
    spinner.fail('Failed to create workspace');
    console.log(chalk.red(`\n  Error: ${err instanceof Error ? err.message : String(err)}`));
    return;
  }

  // 6. Offer to start DB + sync automatically
  const autoStart = await confirm({
    message: 'Start database and sync now?',
    default: true,
  });

  printSummary(workspaceDir, jiraResult, gitResult, dbResult, pgwebPort, autoStart);

  if (autoStart) {
    await startAndSync(workspaceDir, jiraResult !== null, gitResult !== null, pgwebPort);
  }
}

async function startAndSync(workspaceDir: string, hasJira: boolean, hasGit: boolean, pgwebPort: number): Promise<void> {
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

  // Wait for PostgreSQL to be ready
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

  console.log(chalk.dim('  What\'s next:'));
  console.log(`  ${chalk.cyan(`http://localhost:${pgwebPort}`)}            # browse data in pgweb`);
  console.log('');
  console.log(chalk.dim('  Claude integration:'));
  console.log(`    Claude Code:    ${chalk.green('Open this folder — MCP tools ready!')}`);
  console.log(`    Claude Desktop: ${chalk.cyan('argustack mcp install')}`);
  console.log('');
}

// ─── Main entry point ────────────────────────────────────────────────────────

export async function runInit(flags: InitFlags = {}): Promise<void> {
  // --no-interactive sets flags.interactive to false
  if (flags.interactive === false) {
    await runInitNonInteractive(flags);
  } else {
    await runInitInteractive(flags);
  }
}
