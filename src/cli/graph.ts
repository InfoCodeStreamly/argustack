import type { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { PostgresStorage } from '../adapters/postgres/index.js';
import { BuildGraphUseCase } from '../use-cases/build-graph.js';
import { loadHubConfig } from '../workspace/hub-config.js';
import { openHubStore, resolveWorkspaceFlag } from './add/shared.js';

interface BuildOptions {
  workspace?: string;
  since?: string;
}

interface StatsOptions {
  workspace?: string;
}

export function registerGraphCommand(program: Command): void {
  const graph = program
    .command('graph')
    .description('Knowledge graph — build and inspect entity relationships');

  graph
    .command('build')
    .description('Build knowledge graph from synced data for a workspace')
    .option('--workspace <name>', 'Target workspace (defaults to active)')
    .option('--since <date>', 'Incremental build from date (YYYY-MM-DD)')
    .action(async (options: BuildOptions) => {
      const hub = loadHubConfig();
      const { store, close } = await openHubStore();
      const storage = new PostgresStorage(hub.db);
      try {
        const workspaceId = await resolveWorkspaceFlag(store, options.workspace);
        const workspace = await store.getById(workspaceId);
        const repoPaths = workspace?.settings?.gitRepoPaths != null ? [...workspace.settings.gitRepoPaths] : [];

        const spinner = ora('Building knowledge graph...').start();
        try {
          const useCase = new BuildGraphUseCase(storage);
          const stats = await useCase.execute(workspaceId, {
            ...(options.since !== undefined && options.since !== '' ? { since: options.since } : {}),
            ...(repoPaths.length > 0 ? { repoPaths } : {}),
            onProgress: (msg) => { spinner.text = msg; },
          });
          spinner.succeed('Knowledge graph built!');
          console.log(chalk.green(`  ${String(stats.entityCount)} entities, ${String(stats.relationshipCount)} relationships, ${String(stats.observationCount)} observations`));
        } catch (err) {
          spinner.fail('Graph build failed');
          console.error(chalk.red(`  ${err instanceof Error ? err.message : String(err)}`));
          process.exit(1);
        }
      } finally {
        await storage.close();
        await close();
      }
    });

  graph
    .command('stats')
    .description('Show knowledge graph statistics for a workspace')
    .option('--workspace <name>', 'Target workspace (defaults to active)')
    .action(async (options: StatsOptions) => {
      const hub = loadHubConfig();
      const { store, close } = await openHubStore();
      const storage = new PostgresStorage(hub.db);
      try {
        const workspaceId = await resolveWorkspaceFlag(store, options.workspace);
        await storage.initialize();
        const stats = await storage.getGraphStats(workspaceId);

        if (stats.entityCount === 0) {
          console.log(chalk.yellow(`\n  No graph data. Run: argustack graph build --workspace ${  workspaceId}`));
          return;
        }
        console.log(`\n  Knowledge Graph: ${String(stats.entityCount)} entities, ${String(stats.relationshipCount)} relationships, ${String(stats.observationCount)} observations\n`);
        console.log(chalk.dim('  Entities:'));
        for (const [type, count] of Object.entries(stats.byEntityType)) {
          console.log(`    ${type}: ${String(count)}`);
        }
        console.log(chalk.dim('\n  Relationships:'));
        for (const [type, count] of Object.entries(stats.byRelationshipType)) {
          console.log(`    ${type}: ${String(count)}`);
        }
      } finally {
        await storage.close();
        await close();
      }
    });
}
