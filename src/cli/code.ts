import type { Command } from 'commander';
import { resolve, join } from 'node:path';
import { mkdirSync, writeFileSync, existsSync, readFileSync, unlinkSync, openSync } from 'node:fs';
import { spawn } from 'node:child_process';
import chalk from 'chalk';
import ora from 'ora';
import { hubDir, loadHubConfig } from '../workspace/hub-config.js';
import { openHubStore, resolveWorkspaceFlag } from './add/shared.js';
import { PostgresStorage } from '../adapters/postgres/index.js';
import { Neo4jCodeGraphStore } from '../adapters/neo4j/index.js';
import { QdrantCodeVectorStore } from '../adapters/qdrant/index.js';
import { TreeSitterParser } from '../adapters/tree-sitter/index.js';
import { TypeScriptLspClient } from '../adapters/lsp/index.js';
import { VoyageCodeEmbeddingProvider } from '../adapters/voyage/index.js';
import { LmStudioCodeEmbeddingProvider } from '../adapters/lmstudio/index.js';
import { OllamaCodeEmbeddingProvider } from '../adapters/ollama/index.js';
import type { ICodeEmbedding } from '../core/ports/code-embedding.js';
import { RegisterCodeProjectUseCase } from '../use-cases/register-code-project.js';
import { UnregisterCodeProjectUseCase } from '../use-cases/unregister-code-project.js';
import { IndexCodeUseCase } from '../use-cases/index-code.js';
import { WatchCodeUseCase } from '../use-cases/watch-code.js';
import type { CodeProject, CodeLanguage } from '../core/types/code.js';

const WATCHERS_DIR = (): string => join(hubDir(), 'watchers');

function watcherPaths(projectId: string): { pidFile: string; logFile: string } {
  return {
    pidFile: join(WATCHERS_DIR(), `${projectId}.pid`),
    logFile: join(WATCHERS_DIR(), `${projectId}.log`),
  };
}

function readWatcherPid(projectId: string): number | null {
  const { pidFile } = watcherPaths(projectId);
  if (!existsSync(pidFile)) {return null;}
  const pid = parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
  if (!pid) {return null;}
  try {
    process.kill(pid, 0);
    return pid;
  } catch {
    try { unlinkSync(pidFile); } catch { /* ignore */ }
    return null;
  }
}

interface CodeAdapters {
  storage: PostgresStorage;
  graph: Neo4jCodeGraphStore;
  vec: QdrantCodeVectorStore;
  embedding: ICodeEmbedding;
}

function buildAdapters(): CodeAdapters {
  const hub = loadHubConfig();
  if (hub.embedding.provider === 'voyage' && !hub.embedding.voyageApiKey) {
    throw new Error('CODE_EMBEDDING_PROVIDER=voyage requires VOYAGE_API_KEY in ~/.argustack/config.env');
  }

  const storage = new PostgresStorage(hub.db);
  const graph = new Neo4jCodeGraphStore(hub.neo4j);
  const vec = new QdrantCodeVectorStore({ url: hub.qdrant.url });

  let embedding: ICodeEmbedding;
  if (hub.embedding.provider === 'voyage' && hub.embedding.voyageApiKey) {
    embedding = new VoyageCodeEmbeddingProvider({ apiKey: hub.embedding.voyageApiKey });
  } else if (hub.embedding.provider === 'ollama' || hub.embedding.provider === 'custom') {
    const url = hub.embedding.provider === 'custom'
      ? hub.embedding.customUrl
      : hub.embedding.ollamaUrl;
    embedding = new OllamaCodeEmbeddingProvider({
      model: hub.embedding.model,
      dimensions: hub.embedding.dimensions,
      ...(url ? { url } : {}),
    });
  } else {
    const lmsOpts: ConstructorParameters<typeof LmStudioCodeEmbeddingProvider>[0] = {
      model: hub.embedding.model,
      dimensions: hub.embedding.dimensions,
    };
    if (hub.embedding.lmstudioUrl) { lmsOpts.url = hub.embedding.lmstudioUrl; }
    if (hub.embedding.rerankModel) { lmsOpts.rerankModel = hub.embedding.rerankModel; }
    embedding = new LmStudioCodeEmbeddingProvider(lmsOpts);
  }
  return { storage, graph, vec, embedding };
}

async function closeAdapters(adapters: CodeAdapters): Promise<void> {
  await adapters.graph.close();
  await adapters.vec.close();
  await adapters.storage.close();
}


export function registerCodeCommands(program: Command): void {
  const code = program
    .command('code')
    .description('Local code intelligence — graph + semantic search of your codebase');

  code
    .command('init')
    .description('[deprecated] Use `argustack init` — it now bootstraps the full hub including code-intel')
    .action(() => {
      console.log(chalk.yellow('  `argustack code init` is deprecated.'));
      console.log(chalk.dim('  Use `argustack init` — it bootstraps the full hub (pg + neo4j + qdrant) and offers code-intel setup.'));
    });

  code
    .command('register')
    .description('Register a code project for indexing (workspaces.id === code_projects.id)')
    .option('--workspace <name>', 'Target workspace (defaults to active)')
    .option('--root <path>', 'Project root (default: CWD)')
    .option('--language <lang>', 'Primary language (typescript|tsx|javascript|jsx)', 'typescript')
    .action(async (options: { workspace?: string; root?: string; language: string }) => {
      const { store, close: closeStore } = await openHubStore();
      const workspaceId = await resolveWorkspaceFlag(store, options.workspace);
      const workspace = await store.getById(workspaceId);
      await closeStore();
      if (!workspace) { throw new Error(`Workspace "${workspaceId}" not found.`); }
      const root = resolve(options.root ?? process.cwd());
      const project: CodeProject = {
        id: workspaceId,
        name: workspace.name,
        root,
        language: options.language as CodeLanguage,
      };
      const adapters = buildAdapters();
      try {
        await adapters.storage.initialize();
        await adapters.graph.initialize();
        await adapters.vec.initialize();
        const useCase = new RegisterCodeProjectUseCase(
          adapters.storage,
          adapters.graph,
          adapters.vec,
          adapters.embedding,
        );
        await useCase.execute(project);
        console.log(chalk.green(`\n  Registered '${project.name}' at ${project.root}`));
        console.log(chalk.dim(`  projectId: ${project.id}\n`));
      } finally {
        await closeAdapters(adapters);
      }
    });

  code
    .command('unregister')
    .description('Remove a code project and its indexed data')
    .option('--workspace <name>', 'Target workspace (defaults to active)')
    .action(async (options: { workspace?: string }) => {
      const { store, close: closeStore } = await openHubStore();
      const projectId = await resolveWorkspaceFlag(store, options.workspace);
      await closeStore();
      const adapters = buildAdapters();
      try {
        const useCase = new UnregisterCodeProjectUseCase(
          adapters.storage,
          adapters.graph,
          adapters.vec,
        );
        await useCase.execute(projectId);
        console.log(chalk.yellow(`  Unregistered project (id: ${projectId})`));
      } finally {
        await closeAdapters(adapters);
      }
    });

  code
    .command('index')
    .description('Index code (incremental by hash; --full forces full reindex; --status shows last job)')
    .option('--project <id>', 'Project id (default: auto-detect from CWD)')
    .option('--full', 'Full reindex, ignore hashes')
    .option('--status', 'Print latest index job + stats and exit (no indexing)')
    .option('--lsp', 'Use typescript-language-server for cross-file call resolution (slower, more accurate)')
    .action(async (options: { project?: string; full?: boolean; status?: boolean; lsp?: boolean }) => {
      const adapters = buildAdapters();
      const spinner = ora('Resolving project...').start();
      let lspClient: TypeScriptLspClient | null = null;
      try {
        const project = options.project
          ? await adapters.storage.getProjectById(options.project)
          : await adapters.storage.getProjectByRoot(process.cwd());
        if (!project) {
          spinner.fail('Project not registered. Run `argustack code register --name <name>`.');
          process.exitCode = 1;
          return;
        }

        if (options.status) {
          spinner.stop();
          const job = await adapters.storage.getLatestJob(project.id);
          console.log('');
          console.log(`  ${chalk.bold(project.name)} ${chalk.dim(`(${project.id})`)}`);
          console.log(chalk.dim(`    root: ${project.root}`));
          if (!job) {
            console.log(chalk.yellow('    No index jobs recorded yet. Run `argustack code index`.'));
            console.log('');
            return;
          }
          const statusColor = job.status === 'completed'
            ? chalk.green
            : job.status === 'failed' ? chalk.red : chalk.yellow;
          console.log(`    last job:   ${statusColor(job.status)} (${job.type}) #${String(job.id)}`);
          console.log(chalk.dim(`    started:    ${job.startedAt}`));
          if (job.completedAt) {
            console.log(chalk.dim(`    completed:  ${job.completedAt}`));
          }
          if (job.stats) {
            console.log(chalk.dim(
              `    stats:      files=${String(job.stats.filesIndexed)} symbols=${String(job.stats.symbolsCreated)} chunks=${String(job.stats.chunksCreated)} edges=${String(job.stats.edgesCreated)} duration=${String(job.stats.durationMs)}ms`,
            ));
          }
          if (job.error) {
            console.log(chalk.red(`    error:      ${job.error}`));
          }
          console.log('');
          return;
        }

        spinner.text = `Indexing '${project.name}'...`;
        const parser = new TreeSitterParser({ projectRoot: project.root });
        if (options.lsp) {
          const client = new TypeScriptLspClient();
          try {
            await client.start(project.root);
            lspClient = client;
            console.log(chalk.dim('  LSP enabled (typescript-language-server)'));
          } catch (err) {
            console.warn(chalk.yellow(`  LSP unavailable, falling back to heuristic resolver: ${err instanceof Error ? err.message : String(err)}`));
          }
        }
        const useCase = new IndexCodeUseCase(
          parser,
          adapters.graph,
          adapters.vec,
          adapters.embedding,
          adapters.storage,
          lspClient,
        );
        const execInput: Parameters<IndexCodeUseCase['execute']>[0] = {
          project,
          onProgress: (event) => {
            if (event.type === 'started') {
              spinner.text = `Discovering files...`;
            } else if (event.type === 'fileIndexed') {
              spinner.text = `Indexing ${event.relPath} (${String(event.index)}/${String(event.total)})`;
            } else if (event.type === 'fileSkipped') {
              spinner.text = `Skipping ${event.relPath} (unchanged)`;
            } else {
              spinner.text = `Finalizing...`;
            }
          },
        };
        if (options.full !== undefined) {execInput.full = options.full;}
        const stats = await useCase.execute(execInput);
        spinner.succeed(
          `Indexed ${String(stats.filesIndexed)} files / ${String(stats.symbolsCreated)} symbols / ${String(stats.chunksCreated)} chunks in ${String(stats.durationMs)}ms`,
        );
        console.log(chalk.dim(`  edges: ${String(stats.edgesCreated)} | tokens: ~${String(stats.embeddingTokens)}`));
      } catch (err) {
        spinner.fail('Index failed');
        console.error(chalk.red(`  ${err instanceof Error ? err.message : String(err)}`));
        if (err instanceof Error && err.stack) {
          console.error(chalk.dim(err.stack));
        }
        process.exitCode = 1;
      } finally {
        if (lspClient) {
          try { await lspClient.stop(); } catch { /* ignore lsp stop errors */ }
        }
        await closeAdapters(adapters);
      }
    });

  code
    .command('list')
    .description('List registered code projects')
    .action(async () => {
      const adapters = buildAdapters();
      try {
        const projects = await adapters.storage.listProjects();
        if (projects.length === 0) {
          console.log(chalk.dim('\n  No code projects registered. Run `argustack code register --name <name>`.\n'));
          return;
        }
        console.log('');
        for (const p of projects) {
          const lastIndexed = p.lastIndexedAt
            ? new Date(p.lastIndexedAt).toLocaleString()
            : chalk.dim('never');
          console.log(`  ${chalk.green('●')} ${chalk.bold(p.name)} ${chalk.dim(`(${p.id})`)}`);
          console.log(chalk.dim(`    ${p.root}`));
          console.log(chalk.dim(`    language: ${p.language} | last indexed: ${lastIndexed}`));
        }
        console.log('');
      } finally {
        await closeAdapters(adapters);
      }
    });

  code
    .command('status')
    .description('Show status of code intelligence stores and projects')
    .action(async () => {
      const adapters = buildAdapters();
      try {
        const projects = await adapters.storage.listProjects();
        console.log('');
        console.log(chalk.bold('  Containers:'));
        console.log(`    Neo4j:    ${process.env['NEO4J_URI'] ?? 'not set'}`);
        console.log(`    Qdrant:   ${process.env['QDRANT_URL'] ?? 'not set'}`);
        console.log(`    Postgres: ${process.env['DB_HOST'] ?? 'localhost'}:${process.env['DB_PORT'] ?? '5434'}`);
        console.log('');
        console.log(chalk.bold(`  Projects (${String(projects.length)}):`));
        for (const p of projects) {
          const job = await adapters.storage.getLatestJob(p.id);
          const jobInfo = job
            ? `${job.status} (${job.type})`
            : chalk.dim('no jobs');
          const watcherPid = readWatcherPid(p.id);
          const watcherInfo = watcherPid
            ? chalk.cyan(`  ⟳ watching (pid ${String(watcherPid)})`)
            : '';
          console.log(`    ${chalk.green('●')} ${p.name} — ${jobInfo}${watcherInfo}`);
        }
        console.log('');
      } finally {
        await closeAdapters(adapters);
      }
    });

  code
    .command('stats')
    .description('Show stats for a code project')
    .option('--workspace <name>', 'Target workspace (defaults to active)')
    .action(async (options: { workspace?: string }) => {
      const { store, close: closeStore } = await openHubStore();
      const id = await resolveWorkspaceFlag(store, options.workspace);
      await closeStore();
      const adapters = buildAdapters();
      try {
        const project = await adapters.storage.getProjectById(id);
        if (!project) {
          console.log(chalk.red(`\n  Project '${id}' not found.\n`));
          process.exitCode = 1;
          return;
        }
        const vecStats = await adapters.vec.getCollectionStats(project.id);
        const lastJob = await adapters.storage.getLatestJob(project.id);
        console.log('');
        console.log(`  ${chalk.bold(project.name)} ${chalk.dim(`(${project.id})`)}`);
        console.log(`    root:           ${project.root}`);
        console.log(`    vectors:        ${String(vecStats.pointCount)} (dim ${String(vecStats.vectorDim)})`);
        if (lastJob) {
          console.log(`    last job:       ${lastJob.status} ${lastJob.type} @ ${lastJob.startedAt}`);
          if (lastJob.stats) {
            console.log(chalk.dim(`      files=${String(lastJob.stats.filesIndexed)} symbols=${String(lastJob.stats.symbolsCreated)} chunks=${String(lastJob.stats.chunksCreated)} tokens=${String(lastJob.stats.embeddingTokens)}`));
          }
        }
        console.log('');
      } finally {
        await closeAdapters(adapters);
      }
    });

  code
    .command('watch')
    .description('Watch project for real-time indexing (chokidar + debounce)')
    .option('--project <id>', 'Project id (default: auto-detect from CWD)')
    .option('--daemon', 'Run in background, write PID file')
    .option('--stop', 'Stop running daemon for this project')
    .action(async (options: { project?: string; daemon?: boolean; stop?: boolean }) => {
      mkdirSync(WATCHERS_DIR(), { recursive: true });
      const adapters = buildAdapters();

      try {
        const project = options.project
          ? await adapters.storage.getProjectById(options.project)
          : await adapters.storage.getProjectByRoot(process.cwd());
        if (!project) {
          console.log(chalk.red('\n  Project not registered. Run `argustack code register --name <name>`.\n'));
          process.exitCode = 1;
          return;
        }

        if (options.stop) {
          const pid = readWatcherPid(project.id);
          if (!pid) {
            console.log(chalk.yellow(`  No running watcher for '${project.id}'.`));
            return;
          }
          try {
            process.kill(pid, 'SIGTERM');
            const { pidFile } = watcherPaths(project.id);
            try { unlinkSync(pidFile); } catch { /* ignore */ }
            console.log(chalk.green(`  Stopped watcher (pid ${String(pid)}) for '${project.id}'.`));
          } catch (err) {
            console.error(chalk.red(`  Failed to stop: ${err instanceof Error ? err.message : String(err)}`));
          }
          return;
        }

        const existingPid = readWatcherPid(project.id);
        if (existingPid) {
          console.log(chalk.yellow(`  Watcher already running (pid ${String(existingPid)}) for '${project.id}'.`));
          console.log(chalk.dim(`  Use --stop to stop it, or check ${watcherPaths(project.id).logFile}`));
          return;
        }

        if (options.daemon) {
          const { pidFile, logFile } = watcherPaths(project.id);
          const logFd = openSync(logFile, 'a');
          const child = spawn(
            process.execPath,
            [process.argv[1] ?? '', 'code', 'watch', '--project', project.id],
            {
              detached: true,
              stdio: ['ignore', logFd, logFd],
              env: process.env,
            },
          );
          child.unref();
          if (child.pid) {
            writeFileSync(pidFile, String(child.pid));
            console.log(chalk.green(`  Watcher started in background for '${project.id}'`));
            console.log(chalk.dim(`    pid:  ${String(child.pid)}`));
            console.log(chalk.dim(`    log:  ${logFile}`));
            console.log(chalk.dim(`    stop: argustack code watch --project ${project.id} --stop`));
          } else {
            console.error(chalk.red('  Failed to spawn daemon.'));
            process.exitCode = 1;
          }
          return;
        }

        const useCase = new WatchCodeUseCase(
          new TreeSitterParser({ projectRoot: project.root }),
          adapters.graph,
          adapters.vec,
          adapters.embedding,
          adapters.storage,
        );
        const controller = new AbortController();
        const cleanup = (sig: NodeJS.Signals): void => {
          console.log(chalk.dim(`\n  ${sig} received, stopping watcher...`));
          controller.abort();
        };
        process.on('SIGINT', cleanup);
        process.on('SIGTERM', cleanup);

        const { pidFile } = watcherPaths(project.id);
        writeFileSync(pidFile, String(process.pid));

        console.log(chalk.green(`  Watching '${project.name}' at ${project.root}`));
        console.log(chalk.dim('  Save any TS file — change should propagate in ~2 sec. Ctrl+C to stop.\n'));

        try {
          await useCase.start({
            project,
            signal: controller.signal,
            onEvent: (event) => {
              const ts = new Date().toLocaleTimeString();
              if (event.type === 'ready') {
                console.log(chalk.dim(`  [${ts}] ready`));
              } else if (event.type === 'fileIndexed') {
                console.log(chalk.green(`  [${ts}] indexed: ${event.path}`));
              } else if (event.type === 'fileRemoved') {
                console.log(chalk.yellow(`  [${ts}] removed: ${event.path}`));
              } else {
                console.error(chalk.red(`  [${ts}] error: ${event.error.message}`));
              }
            },
          });
        } finally {
          try { unlinkSync(pidFile); } catch { /* ignore */ }
        }
      } finally {
        await closeAdapters(adapters);
      }
    });
}
