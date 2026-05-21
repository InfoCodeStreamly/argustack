import { resolve } from 'node:path';
import type { Command } from 'commander';
import chalk from 'chalk';
import type { CodeLanguage, CodeProject } from '../../core/types/index.js';
import { openHubStore, resolveWorkspaceFlag } from './shared.js';
import { RegisterCodeProjectUseCase } from '../../use-cases/register-code-project.js';
import type { HubConfig } from '../../workspace/hub-config.js';
import type { ICodeEmbedding } from '../../core/ports/code-embedding.js';

interface Options {
  workspace?: string;
  root?: string;
  language?: string;
}

const SUPPORTED_LANGUAGES: readonly CodeLanguage[] = ['typescript', 'tsx', 'javascript', 'jsx'];

function normalizeLanguage(value: string | undefined): CodeLanguage {
  const v = (value ?? 'typescript').toLowerCase();
  if (v === 'ts') {
    return 'typescript';
  }
  if (v === 'js') {
    return 'javascript';
  }
  if (!SUPPORTED_LANGUAGES.includes(v as CodeLanguage)) {
    throw new Error(`Unknown language "${value}". Supported: ${SUPPORTED_LANGUAGES.join(', ')}.`);
  }
  return v as CodeLanguage;
}

export function registerCodeCommand(group: Command): void {
  group
    .command('code')
    .description('Register a code-intelligence project (workspaces.id === code_projects.id)')
    .option('--workspace <name>', 'Target workspace (defaults to active)')
    .requiredOption('--root <path>', 'Absolute path to the project root')
    .option('--language <lang>', 'Primary language (defaults to typescript)', 'typescript')
    .action(async (opts: Options) => {
      if (!opts.root) {
        throw new Error('--root is required.');
      }
      const absoluteRoot = resolve(opts.root);
      const language = normalizeLanguage(opts.language);

      const { store, close } = await openHubStore();
      try {
        const workspaceId = await resolveWorkspaceFlag(store, opts.workspace);

        const { loadHubConfig } = await import('../../workspace/hub-config.js');
        const hub = loadHubConfig();
        if (!hub.embedding.userConfigured) {
          throw new Error(
            'Code intelligence is not configured.\n' +
            'Run `argustack init` (without --skip-llm) to set up an embedding provider first.',
          );
        }

        const { PostgresStorage } = await import('../../adapters/postgres/index.js');
        const { Neo4jCodeGraphStore } = await import('../../adapters/neo4j/index.js');
        const { QdrantCodeVectorStore } = await import('../../adapters/qdrant/index.js');
        const storage = new PostgresStorage(hub.db);
        const graph = new Neo4jCodeGraphStore(hub.neo4j);
        const vec = new QdrantCodeVectorStore({ url: hub.qdrant.url });
        const embedding = await buildEmbedding(hub);

        try {
          const project: CodeProject = {
            id: workspaceId,
            name: workspaceId,
            root: absoluteRoot,
            language,
          };
          const useCase = new RegisterCodeProjectUseCase(storage, graph, vec, embedding);
          await useCase.execute(project);
          console.log(chalk.green(`  ● registered code project for workspace "${workspaceId}" at ${absoluteRoot}`));
          console.log(chalk.dim(`    Neo4j project + Qdrant collection (${String(hub.embedding.dimensions)}d) created.`));
          console.log(chalk.dim('    Run `argustack code index --project ' + workspaceId + '` to build the index.'));
        } finally {
          await Promise.allSettled([graph.close(), vec.close(), storage.close()]);
        }
      } finally {
        await close();
      }
    });
}

async function buildEmbedding(hub: HubConfig): Promise<ICodeEmbedding> {
  if (hub.embedding.provider === 'voyage' && hub.embedding.voyageApiKey) {
    const { VoyageCodeEmbeddingProvider } = await import('../../adapters/voyage/index.js');
    return new VoyageCodeEmbeddingProvider({ apiKey: hub.embedding.voyageApiKey });
  }
  if (hub.embedding.provider === 'ollama' || hub.embedding.provider === 'custom') {
    const { OllamaCodeEmbeddingProvider } = await import('../../adapters/ollama/index.js');
    const url = hub.embedding.provider === 'custom' ? hub.embedding.customUrl : hub.embedding.ollamaUrl;
    return new OllamaCodeEmbeddingProvider({
      model: hub.embedding.model,
      dimensions: hub.embedding.dimensions,
      ...(url ? { url } : {}),
    });
  }
  const { LmStudioCodeEmbeddingProvider } = await import('../../adapters/lmstudio/index.js');
  const opts: ConstructorParameters<typeof LmStudioCodeEmbeddingProvider>[0] = {
    model: hub.embedding.model,
    dimensions: hub.embedding.dimensions,
  };
  if (hub.embedding.lmstudioUrl) { opts.url = hub.embedding.lmstudioUrl; }
  if (hub.embedding.rerankModel) { opts.rerankModel = hub.embedding.rerankModel; }
  return new LmStudioCodeEmbeddingProvider(opts);
}
