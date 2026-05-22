import type { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { PostgresStorage } from '../adapters/postgres/index.js';
import { OpenAIEmbeddingProvider } from '../adapters/openai/index.js';
import { EmbedUseCase } from '../use-cases/embed.js';
import { loadHubConfig } from '../workspace/hub-config.js';
import { openHubStore, resolveWorkspaceFlag } from './add/shared.js';

interface Options {
  workspace?: string;
  batchSize?: string;
}

export function registerEmbedCommand(program: Command): void {
  program
    .command('embed')
    .description('Generate OpenAI embeddings for issues in a workspace')
    .option('--workspace <name>', 'Target workspace (defaults to active)')
    .option('--batch-size <n>', 'Texts per API call (default: 100)', '100')
    .action(async (options: Options) => {
      const hub = loadHubConfig();
      if (hub.embedding.openaiApiKey === undefined || hub.embedding.openaiApiKey === '') {
        console.log(chalk.red('\n  Missing OPENAI_API_KEY in ~/.argustack/config.env'));
        process.exit(1);
      }

      const { store, close } = await openHubStore();
      const storage = new PostgresStorage(hub.db);
      try {
        const workspaceId = await resolveWorkspaceFlag(store, options.workspace);
        const embeddingProvider = new OpenAIEmbeddingProvider({ apiKey: hub.embedding.openaiApiKey });
        const useCase = new EmbedUseCase(embeddingProvider, storage);
        const spinner = ora('Generating embeddings...').start();
        try {
          const result = await useCase.execute(workspaceId, {
            batchSize: parseInt(options.batchSize ?? '100', 10),
            onProgress: (msg) => { spinner.text = msg; },
          });
          spinner.succeed('Embedding complete!');
          console.log(chalk.green(`  ${String(result.embeddedCount)} issues embedded, ${String(result.skippedCount)} skipped`));
        } catch (err) {
          spinner.fail('Embedding failed');
          console.error(chalk.red(`  ${err instanceof Error ? err.message : String(err)}`));
          process.exit(1);
        }
      } finally {
        await storage.close();
        await close();
      }
    });
}
