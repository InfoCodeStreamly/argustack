import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { DbConfig } from '../adapters/postgres/connection.js';

const HUB_DIR_NAME = '.argustack';
const CONFIG_ENV_FILE = 'config.env';

export interface HubNeo4jConfig {
  readonly uri: string;
  readonly user: string;
  readonly password: string;
}

export interface HubQdrantConfig {
  readonly url: string;
}

export type HubEmbeddingProvider = 'lmstudio' | 'voyage' | 'ollama' | 'custom';

export interface HubEmbeddingConfig {
  readonly provider: HubEmbeddingProvider;
  readonly lmstudioUrl?: string;
  readonly ollamaUrl?: string;
  /** Used for provider='custom' — OpenAI-compatible /api/embeddings endpoint. */
  readonly customUrl?: string;
  readonly model: string;
  readonly dimensions: number;
  readonly rerankModel?: string;
  readonly voyageApiKey?: string;
  readonly openaiApiKey?: string;
  /**
   * True only when `CODE_EMBEDDING_PROVIDER` is explicitly set in config.env
   * or process.env. When false, all other fields are merely sensible defaults
   * and code-intelligence is NOT actually configured.
   */
  readonly userConfigured: boolean;
}

export interface HubCredentials {
  readonly jiraUrl?: string;
  readonly jiraEmail?: string;
  readonly jiraApiToken?: string;
  readonly jiraProxyToken?: string;
  readonly githubToken?: string;
}

export interface HubConfig {
  readonly hubDir: string;
  readonly db: DbConfig;
  readonly neo4j: HubNeo4jConfig;
  readonly qdrant: HubQdrantConfig;
  readonly embedding: HubEmbeddingConfig;
  readonly credentials: HubCredentials;
}

let cached: HubConfig | null = null;

/**
 * Resolve the hub root directory (`~/.argustack`). Honours `ARGUSTACK_HUB_DIR`
 * env var so tests can isolate state without touching `$HOME`.
 */
export function hubDir(): string {
  return process.env['ARGUSTACK_HUB_DIR'] ?? join(homedir(), HUB_DIR_NAME);
}

export function hubConfigPath(): string {
  return join(hubDir(), CONFIG_ENV_FILE);
}

/**
 * Load `~/.argustack/config.env` and merge with `process.env`.
 * Cached after first call — tests that need a fresh load must call
 * {@link resetHubConfigCache}.
 *
 * @throws Error when `config.env` does not exist (hub not initialised).
 */
export function loadHubConfig(): HubConfig {
  if (cached) {
    return cached;
  }

  const path = hubConfigPath();
  if (!existsSync(path)) {
    throw new Error(
      `Hub config not found at ${path}. Run "argustack init" to bootstrap the hub.`,
    );
  }

  const env = parseEnvFile(readFileSync(path, 'utf-8'));
  const merged = { ...env, ...process.env };

  const rawProvider = merged['CODE_EMBEDDING_PROVIDER']?.toLowerCase();
  const userConfigured = typeof rawProvider === 'string' && rawProvider.length > 0;
  const provider: HubEmbeddingProvider =
    rawProvider === 'voyage' ? 'voyage' :
    rawProvider === 'lmstudio' ? 'lmstudio' :
    rawProvider === 'custom' ? 'custom' :
    'ollama';

  const credentials: { -readonly [K in keyof HubCredentials]: HubCredentials[K] } = {};
  if (merged['JIRA_URL']) {
    credentials.jiraUrl = merged['JIRA_URL'];
  }
  if (merged['JIRA_EMAIL']) {
    credentials.jiraEmail = merged['JIRA_EMAIL'];
  }
  if (merged['JIRA_API_TOKEN']) {
    credentials.jiraApiToken = merged['JIRA_API_TOKEN'];
  }
  if (merged['JIRA_PROXY_TOKEN']) {
    credentials.jiraProxyToken = merged['JIRA_PROXY_TOKEN'];
  }
  if (merged['GITHUB_TOKEN']) {
    credentials.githubToken = merged['GITHUB_TOKEN'];
  }

  const config: HubConfig = {
    hubDir: hubDir(),
    db: {
      host: merged['DB_HOST'] ?? 'localhost',
      port: Number(merged['DB_PORT'] ?? '15432'),
      user: merged['DB_USER'] ?? 'argustack',
      password: merged['DB_PASSWORD'] ?? 'argustack_hub',
      database: merged['DB_NAME'] ?? 'argustack_hub',
    },
    neo4j: {
      uri: merged['NEO4J_URI'] ?? 'bolt://localhost:15435',
      user: merged['NEO4J_USER'] ?? 'neo4j',
      password: merged['NEO4J_PASSWORD'] ?? 'argustack_local',
    },
    qdrant: {
      url: merged['QDRANT_URL'] ?? 'http://localhost:15436',
    },
    embedding: buildEmbedding(provider, userConfigured, merged),
    credentials,
  };
  cached = config;
  return config;
}

function buildEmbedding(
  provider: HubEmbeddingProvider,
  userConfigured: boolean,
  env: Record<string, string | undefined>,
): HubEmbeddingConfig {
  const defaults = {
    ollama: { model: 'nomic-embed-text', dims: 768 },
    lmstudio: { model: 'text-embedding-qwen3-embedding-4b', dims: 1024 },
    voyage: { model: 'voyage-code-3', dims: 1024 },
    custom: { model: 'unknown', dims: 768 },
  } as const;
  const d = defaults[provider];
  const config: {
    -readonly [K in keyof HubEmbeddingConfig]: HubEmbeddingConfig[K];
  } = {
    provider,
    userConfigured,
    model: env['EMBEDDING_MODEL'] ?? d.model,
    dimensions: Number(env['EMBEDDING_DIMS'] ?? String(d.dims)),
  };
  if (env['LMSTUDIO_URL']) {
    config.lmstudioUrl = env['LMSTUDIO_URL'];
  }
  if (env['OLLAMA_URL']) {
    config.ollamaUrl = env['OLLAMA_URL'];
  }
  if (env['CUSTOM_EMBEDDING_URL']) {
    config.customUrl = env['CUSTOM_EMBEDDING_URL'];
  }
  if (env['RERANK_MODEL']) {
    config.rerankModel = env['RERANK_MODEL'];
  }
  if (env['VOYAGE_API_KEY']) {
    config.voyageApiKey = env['VOYAGE_API_KEY'];
  }
  if (env['OPENAI_API_KEY']) {
    config.openaiApiKey = env['OPENAI_API_KEY'];
  }
  return config;
}

/**
 * Reset the cached hub config — for tests that mutate `~/.argustack/config.env`
 * or `ARGUSTACK_HUB_DIR` between cases.
 */
export function resetHubConfigCache(): void {
  cached = null;
}

function parseEnvFile(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const eq = line.indexOf('=');
    if (eq === -1) {
      continue;
    }
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}
