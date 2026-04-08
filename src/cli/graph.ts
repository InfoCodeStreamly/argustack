import type { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import dotenv from 'dotenv';
import { requireWorkspace } from '../workspace/resolver.js';
import { PostgresStorage } from '../adapters/postgres/index.js';
import { BuildGraphUseCase } from '../use-cases/build-graph.js';

export function registerGraphCommand(program: Command): void {
  const graph = program
    .command('graph')
    .description('Knowledge graph — build and query entity relationships');

  graph
    .command('build')
    .description('Build knowledge graph from synced data')
    .option('--since <date>', 'Incremental build from date (YYYY-MM-DD)')
    .action(async (options: { since?: string }) => {
      const workspaceRoot = requireWorkspace();
      dotenv.config({ path: `${workspaceRoot}/.env`, quiet: true });

      const repoPaths = (process.env['GIT_REPO_PATHS'] ?? process.env['GIT_REPO_PATH'] ?? '')
        .split(',').map((p) => p.trim()).filter(Boolean);

      const storage = new PostgresStorage({
        host: process.env['DB_HOST'] ?? 'localhost',
        port: parseInt(process.env['DB_PORT'] ?? '5434', 10),
        database: process.env['DB_NAME'] ?? 'argustack',
        user: process.env['DB_USER'] ?? 'argustack',
        password: process.env['DB_PASSWORD'] ?? 'argustack_local',
      });

      const spinner = ora('Building knowledge graph...').start();

      try {
        const useCase = new BuildGraphUseCase(storage);
        const stats = await useCase.execute({
          ...(options.since ? { since: options.since } : {}),
          ...(repoPaths.length > 0 ? { repoPaths } : {}),
          onProgress: (msg) => { spinner.text = msg; },
        });

        spinner.succeed('Knowledge graph built!');
        console.log('');
        console.log(chalk.green(`  ${String(stats.entityCount)} entities, ${String(stats.relationshipCount)} relationships, ${String(stats.observationCount)} observations`));
        console.log('');

        console.log(chalk.dim('  Entities by type:'));
        for (const [type, count] of Object.entries(stats.byEntityType)) {
          console.log(`    ${type}: ${String(count)}`);
        }
        console.log('');
        console.log(chalk.dim('  Relationships by type:'));
        for (const [type, count] of Object.entries(stats.byRelationshipType)) {
          console.log(`    ${type}: ${String(count)}`);
        }
        console.log('');
      } catch (err: unknown) {
        spinner.fail('Graph build failed');
        console.error(chalk.red(`  ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
      } finally {
        await storage.close();
      }
    });

  graph
    .command('stats')
    .description('Show knowledge graph statistics')
    .action(async () => {
      const workspaceRoot = requireWorkspace();
      dotenv.config({ path: `${workspaceRoot}/.env`, quiet: true });

      const storage = new PostgresStorage({
        host: process.env['DB_HOST'] ?? 'localhost',
        port: parseInt(process.env['DB_PORT'] ?? '5434', 10),
        database: process.env['DB_NAME'] ?? 'argustack',
        user: process.env['DB_USER'] ?? 'argustack',
        password: process.env['DB_PASSWORD'] ?? 'argustack_local',
      });

      try {
        await storage.initialize();
        const stats = await storage.getGraphStats();

        if (stats.entityCount === 0) {
          console.log(chalk.yellow('\n  No graph data. Run: argustack graph build\n'));
          return;
        }

        console.log(`\n  Knowledge Graph: ${String(stats.entityCount)} entities, ${String(stats.relationshipCount)} relationships, ${String(stats.observationCount)} observations\n`);

        console.log(chalk.dim('  Entities:'));
        for (const [type, count] of Object.entries(stats.byEntityType)) {
          console.log(`    ${type}: ${String(count)}`);
        }
        console.log('');
        console.log(chalk.dim('  Relationships:'));
        for (const [type, count] of Object.entries(stats.byRelationshipType)) {
          console.log(`    ${type}: ${String(count)}`);
        }
        console.log('');
      } finally {
        await storage.close();
      }
    });
}
