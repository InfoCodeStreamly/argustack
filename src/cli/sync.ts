import type { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { JiraProvider } from '../adapters/jira/index.js';
import {
  ProxyJiraProvider,
  loadProxyConfigForWorkspace,
  proxyConfigExistsForWorkspace,
} from '../adapters/jira-proxy/index.js';
import { GitProvider } from '../adapters/git/index.js';
import { CsvProvider } from '../adapters/csv/index.js';
import { GitHubProvider } from '../adapters/github/index.js';
import { DbProvider } from '../adapters/db/index.js';
import { PostgresStorage } from '../adapters/postgres/index.js';
import { PullUseCase } from '../use-cases/pull.js';
import { PullGitUseCase } from '../use-cases/pull-git.js';
import { PullGitHubUseCase } from '../use-cases/pull-github.js';
import { PullDbUseCase } from '../use-cases/pull-db.js';
import { loadHubConfig } from '../workspace/hub-config.js';
import type { ISourceProvider } from '../core/ports/source-provider.js';
import type { Workspace, SourceType } from '../core/types/index.js';
import { openHubStore, resolveWorkspaceFlag } from './add/shared.js';
import { ALL_SOURCES } from '../core/types/index.js';

interface SyncOptions {
  workspace?: string;
  project?: string;
  since?: string;
  file?: string;
}

function createStorage(): PostgresStorage {
  const hub = loadHubConfig();
  return new PostgresStorage(hub.db);
}

function resolveJiraProjectKeys(workspace: Workspace, options: SyncOptions): string[] {
  if (options.project !== undefined && options.project !== '') {
    return [options.project];
  }
  const bound = workspace.settings?.jiraProjectKeys;
  if (bound !== undefined) {
    return [...bound];
  }
  return [];
}

async function syncJira(workspace: Workspace, options: SyncOptions): Promise<void> {
  const hub = loadHubConfig();
  const projectKeys = resolveJiraProjectKeys(workspace, options);

  if (projectKeys.length === 0) {
    console.log(chalk.yellow(`  No Jira projects bound to workspace "${workspace.id}"`));
    console.log(chalk.dim(`  Run: argustack add jira --workspace ${workspace.id} --projects KEY,KEY2`));
    return;
  }

  let source: ISourceProvider;
  if (proxyConfigExistsForWorkspace(workspace.id)) {
    const proxyConfig = loadProxyConfigForWorkspace(workspace.id);
    source = new ProxyJiraProvider(proxyConfig);
    console.log(chalk.dim(`  Using proxy: ${proxyConfig.name}`));
  } else if (
    hub.credentials.jiraUrl !== undefined && hub.credentials.jiraUrl !== '' &&
    hub.credentials.jiraEmail !== undefined && hub.credentials.jiraEmail !== '' &&
    hub.credentials.jiraApiToken !== undefined && hub.credentials.jiraApiToken !== ''
  ) {
    source = new JiraProvider({
      host: hub.credentials.jiraUrl,
      email: hub.credentials.jiraEmail,
      apiToken: hub.credentials.jiraApiToken,
    });
  } else {
    console.log(chalk.red('  Missing Jira credentials in ~/.argustack/config.env'));
    console.log(chalk.dim(`  Run: argustack add jira --workspace ${workspace.id} --url ... --email ... --token ...`));
    return;
  }

  const storage = createStorage();
  const spinner = ora('Syncing Jira...').start();
  try {
    for (const projectKey of projectKeys) {
      const pull = new PullUseCase(source, storage);
      const results = await pull.execute(workspace.id, {
        projectKey,
        ...(options.since !== undefined && options.since !== '' ? { since: options.since } : {}),
        onProgress: (msg) => { spinner.text = msg; },
      });
      for (const r of results) {
        console.log(chalk.green(`  ${r.projectKey}: ${String(r.issuesCount)} issues, ${String(r.commentsCount)} comments, ${String(r.changelogsCount)} changelogs`));
      }
    }
    spinner.succeed('Jira sync complete!');
  } catch (err) {
    spinner.fail(`Jira sync failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await storage.close();
  }
}

async function syncGit(workspace: Workspace, options: SyncOptions): Promise<void> {
  const repos = workspace.settings?.gitRepoPaths ?? [];
  if (repos.length === 0) {
    console.log(chalk.yellow(`  No git repos bound to workspace "${workspace.id}"`));
    console.log(chalk.dim(`  Run: argustack add git --workspace ${workspace.id} --root /path/to/repo`));
    return;
  }

  const storage = createStorage();
  const spinner = ora('Syncing Git...').start();
  const since = options.since !== undefined && options.since !== '' ? new Date(options.since) : undefined;
  try {
    for (const repoPath of repos) {
      const repoName = repoPath.split('/').pop() ?? repoPath;
      spinner.text = `Syncing Git: ${repoName}`;
      try {
        const git = new GitProvider(repoPath);
        const pull = new PullGitUseCase(git, storage);
        const result = await pull.execute(workspace.id, repoPath, {
          ...(since != null ? { since } : {}),
          onProgress: (msg) => { spinner.text = msg; },
        });
        console.log(chalk.green(`  ✓ ${repoName}: ${String(result.commitsCount)} commits, ${String(result.filesCount)} files, ${String(result.issueRefsCount)} issue refs`));
      } catch (err) {
        console.log(chalk.red(`  ✗ ${repoName}: ${err instanceof Error ? err.message : String(err)}`));
      }
    }
    spinner.succeed('Git sync complete!');
  } finally {
    await storage.close();
  }
}

async function syncGithub(workspace: Workspace, options: SyncOptions): Promise<void> {
  const hub = loadHubConfig();
  if (hub.credentials.githubToken === undefined || hub.credentials.githubToken === '') {
    console.log(chalk.red('  Missing GITHUB_TOKEN in ~/.argustack/config.env'));
    return;
  }
  const repos = workspace.settings?.githubRepos ?? [];
  if (repos.length === 0) {
    console.log(chalk.yellow(`  No GitHub repos bound to workspace "${workspace.id}"`));
    console.log(chalk.dim(`  Run: argustack add github --workspace ${workspace.id} --owner X --repo Y`));
    return;
  }

  const storage = createStorage();
  const spinner = ora('Syncing GitHub PRs...').start();
  const since = options.since !== undefined && options.since !== '' ? new Date(options.since) : undefined;
  try {
    for (const { owner, repo } of repos) {
      const provider = new GitHubProvider({ token: hub.credentials.githubToken, owner, repo });
      const pull = new PullGitHubUseCase(provider, storage);
      const repoFullName = `${owner}/${repo}`;
      spinner.text = `Syncing GitHub: ${repoFullName}`;
      const result = await pull.execute(workspace.id, repoFullName, {
        ...(since != null ? { since } : {}),
        onProgress: (msg) => { spinner.text = msg; },
      });
      console.log(chalk.green(`  ✓ ${repoFullName}: ${String(result.prsCount)} PRs, ${String(result.reviewsCount)} reviews, ${String(result.releasesCount)} releases`));
    }
    spinner.succeed('GitHub sync complete!');
  } finally {
    await storage.close();
  }
}

async function syncCsv(workspace: Workspace, options: SyncOptions): Promise<void> {
  const explicit = options.file;
  const bound = workspace.settings?.csvFilePaths ?? [];
  const paths = explicit !== undefined && explicit !== '' ? [explicit] : bound.map((b) => b.path);
  if (paths.length === 0) {
    console.log(chalk.yellow(`  No CSV files bound to workspace "${workspace.id}"`));
    return;
  }

  const storage = createStorage();
  const spinner = ora('Importing Jira CSV...').start();
  try {
    for (const csvFilePath of paths) {
      const source = new CsvProvider(csvFilePath);
      const projects = await source.getProjects();
      const projectKeys = options.project !== undefined && options.project !== '' ? [options.project] : projects.map((p) => p.key);
      for (const projectKey of projectKeys) {
        const pull = new PullUseCase(source, storage);
        const results = await pull.execute(workspace.id, {
          projectKey,
          ...(options.since !== undefined && options.since !== '' ? { since: options.since } : {}),
          onProgress: (msg) => { spinner.text = msg; },
        });
        for (const r of results) {
          console.log(chalk.green(`  ${r.projectKey}: ${String(r.issuesCount)} issues, ${String(r.commentsCount)} comments`));
        }
      }
    }
    spinner.succeed('CSV import complete!');
  } finally {
    await storage.close();
  }
}

async function syncDb(workspace: Workspace, _options: SyncOptions): Promise<void> {
  const dbs = workspace.settings?.dbConfigs ?? [];
  if (dbs.length === 0) {
    console.log(chalk.yellow(`  No external DBs bound to workspace "${workspace.id}"`));
    return;
  }
  const storage = createStorage();
  const spinner = ora('Syncing database schema...').start();
  try {
    for (const cfg of dbs) {
      const provider = new DbProvider({
        engine: cfg.engine,
        host: cfg.host,
        port: cfg.port,
        user: cfg.user,
        password: cfg.password,
        database: cfg.database,
        name: cfg.name,
      });
      const pull = new PullDbUseCase(provider, storage);
      const result = await pull.execute(workspace.id, cfg.name, {
        onProgress: (msg) => { spinner.text = msg; },
      });
      console.log(chalk.green(`  ✓ ${cfg.name}: ${String(result.tablesCount)} tables, ${String(result.columnsCount)} columns`));
    }
    spinner.succeed('DB sync complete!');
  } finally {
    await storage.close();
  }
}

function enabledSourcesFor(workspace: Workspace): SourceType[] {
  const settings = workspace.settings ?? {};
  const sources: SourceType[] = [];
  if ((settings.jiraProjectKeys?.length ?? 0) > 0) { sources.push('jira'); }
  if ((settings.gitRepoPaths?.length ?? 0) > 0) { sources.push('git'); }
  if ((settings.githubRepos?.length ?? 0) > 0) { sources.push('github'); }
  if ((settings.csvFilePaths?.length ?? 0) > 0) { sources.push('csv'); }
  if ((settings.dbConfigs?.length ?? 0) > 0) { sources.push('db'); }
  return sources;
}

export function registerSyncCommand(program: Command): void {
  program
    .command('sync [type]')
    .description('Sync data for the active or selected workspace')
    .option('--workspace <name>', 'Target workspace (defaults to active)')
    .option('-p, --project <key>', 'Sync only a specific Jira project key')
    .option('--since <date>', 'Sync entries updated since YYYY-MM-DD')
    .option('-f, --file <path>', 'CSV file path (for csv source)')
    .action(async (type: string | undefined, options: SyncOptions) => {
      const { store, close } = await openHubStore();
      try {
        const workspaceId = await resolveWorkspaceFlag(store, options.workspace);
        const workspace = await store.getById(workspaceId);
        if (workspace == null) {
          throw new Error(`Workspace "${workspaceId}" disappeared during resolution.`);
        }

        const sources = type !== undefined && type !== ''
          ? [type.toLowerCase() as SourceType]
          : enabledSourcesFor(workspace);

        if (sources.length === 0) {
          console.log(chalk.yellow(`\n  No sources configured for "${workspace.name}".`));
          console.log(chalk.dim(`  Add one: argustack add jira --workspace ${workspace.id} --projects KEY`));
          return;
        }
        for (const s of sources) {
          if (!ALL_SOURCES.includes(s)) {
            throw new Error(`Unknown source "${s}". Available: ${ALL_SOURCES.join(', ')}.`);
          }
        }

        console.log('');
        for (const source of sources) {
          switch (source) {
            case 'jira': await syncJira(workspace, options); break;
            case 'git': await syncGit(workspace, options); break;
            case 'github': await syncGithub(workspace, options); break;
            case 'csv': await syncCsv(workspace, options); break;
            case 'db': await syncDb(workspace, options); break;
            case 'board': break;
            case 'code': break;
          }
        }

        await store.touchActive(workspace.id);
      } finally {
        await close();
      }
    });
}
