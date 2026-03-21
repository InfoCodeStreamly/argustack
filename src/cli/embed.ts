import type { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import dotenv from 'dotenv';
import { requireWorkspace } from '../workspace/resolver.js';
import { PostgresStorage } from '../adapters/postgres/index.js';
import { OpenAIEmbeddingProvider } from '../adapters/openai/index.js';
import { EmbedUseCase } from '../use-cases/embed.js';

export function registerEmbedCommand(program: Command): void {
  program
    .command('embed')
    .description('Generate vector embeddings for issues (requires OPENAI_API_KEY)')
    .option('--batch-size <n>', 'Texts per API call (default: 100)', '100')
    .action(async (options: { batchSize?: string }) => {
      try {
        const workspaceRoot = requireWorkspace();
        dotenv.config({ path: `${workspaceRoot}/.env` });

        const apiKey = process.env['OPENAI_API_KEY'];
        if (!apiKey) {
          console.log(chalk.red('\n  Missing OPENAI_API_KEY in .env'));
          console.log(chalk.dim('  Add: OPENAI_API_KEY=sk-...'));
          process.exit(1);
        }

        const storage = new PostgresStorage({
          host: process.env['DB_HOST'] ?? 'localhost',
          port: parseInt(process.env['DB_PORT'] ?? '5434', 10),
          user: process.env['DB_USER'] ?? 'argustack',
          password: process.env['DB_PASSWORD'] ?? 'argustack_local',
          database: process.env['DB_NAME'] ?? 'argustack',
        });

        const embeddingProvider = new OpenAIEmbeddingProvider({ apiKey });
        const useCase = new EmbedUseCase(embeddingProvider, storage);
        const spinner = ora('Generating embeddings...').start();

        try {
          const result = await useCase.execute({
            batchSize: parseInt(options.batchSize ?? '100', 10),
            onProgress: (msg) => { spinner.text = msg; },
          });

          spinner.succeed('Embedding complete!');
          console.log(chalk.green(`  ${String(result.embeddedCount)} issues embedded, ${String(result.skippedCount)} skipped`));
          console.log('');
        } finally {
          await storage.close();
        }
      } catch (err: unknown) {
        console.error(chalk.red(`\n  Error: ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
      }
    });
}
