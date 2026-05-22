/**
 * Unit tests for `workspace/hub-config.ts`.
 *
 * The module reads `~/.argustack/config.env` once and caches the result.
 * Tests mock `node:fs` and drive `hubDir()` via the documented
 * `ARGUSTACK_HUB_DIR` env hook. The cache is reset between every test
 * via {@link resetHubConfigCache}.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import type * as HubConfigModuleNs from '../../../src/workspace/hub-config.js';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

let existsSync: ReturnType<typeof vi.fn>;
let readFileSync: ReturnType<typeof vi.fn>;

const HUB_DIR = '/tmp/test-hub';
const CONFIG_PATH = join(HUB_DIR, 'config.env');

let hubConfigModule: typeof HubConfigModuleNs;

const originalEnv = { ...process.env };

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  process.env['ARGUSTACK_HUB_DIR'] = HUB_DIR;
  delete process.env['DB_HOST'];
  delete process.env['DB_PORT'];
  delete process.env['DB_USER'];
  delete process.env['DB_PASSWORD'];
  delete process.env['DB_NAME'];
  delete process.env['NEO4J_URI'];
  delete process.env['NEO4J_USER'];
  delete process.env['NEO4J_PASSWORD'];
  delete process.env['QDRANT_URL'];
  delete process.env['CODE_EMBEDDING_PROVIDER'];
  delete process.env['EMBEDDING_MODEL'];
  delete process.env['EMBEDDING_DIMS'];
  delete process.env['LMSTUDIO_URL'];
  delete process.env['OLLAMA_URL'];
  delete process.env['CUSTOM_EMBEDDING_URL'];
  delete process.env['RERANK_MODEL'];
  delete process.env['VOYAGE_API_KEY'];
  delete process.env['OPENAI_API_KEY'];
  delete process.env['JIRA_URL'];
  delete process.env['JIRA_EMAIL'];
  delete process.env['JIRA_API_TOKEN'];
  delete process.env['JIRA_PROXY_TOKEN'];
  delete process.env['GITHUB_TOKEN'];

  const fsMod = await import('node:fs');
  existsSync = vi.mocked(fsMod.existsSync);
  readFileSync = vi.mocked(fsMod.readFileSync);

  hubConfigModule = await import('../../../src/workspace/hub-config.js');
  hubConfigModule.resetHubConfigCache();
});

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) {
      Reflect.deleteProperty(process.env, key);
    }
  }
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value !== undefined) {
      process.env[key] = value;
    }
  }
});

describe('hubDir', () => {
  it('honours ARGUSTACK_HUB_DIR when set', () => {
    expect(hubConfigModule.hubDir()).toBe(HUB_DIR);
  });

  it('hubConfigPath joins config.env onto the hub dir', () => {
    expect(hubConfigModule.hubConfigPath()).toBe(CONFIG_PATH);
  });
});

describe('loadHubConfig', () => {
  it('throws when config.env does not exist', () => {
    existsSync.mockReturnValue(false);

    expect(() => hubConfigModule.loadHubConfig()).toThrow(/Hub config not found/);
  });

  it('returns built-in defaults when config.env is empty', () => {
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue('');

    const config = hubConfigModule.loadHubConfig();

    expect(config.hubDir).toBe(HUB_DIR);
    expect(config.db).toEqual({
      host: 'localhost',
      port: 15432,
      user: 'argustack',
      password: 'argustack_hub',
      database: 'argustack_hub',
    });
    expect(config.neo4j.uri).toBe('bolt://localhost:15435');
    expect(config.qdrant.url).toBe('http://localhost:15436');
    expect(config.embedding.provider).toBe('ollama');
    expect(config.embedding.userConfigured).toBe(false);
  });

  it('caches the config across calls', () => {
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue('');

    const first = hubConfigModule.loadHubConfig();
    const second = hubConfigModule.loadHubConfig();

    expect(second).toBe(first);
    expect(readFileSync).toHaveBeenCalledOnce();
  });

  it('parses DB_* fields from config.env', () => {
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue(
      [
        'DB_HOST=db.internal',
        'DB_PORT=6543',
        'DB_USER=app',
        'DB_PASSWORD=s3cret',
        'DB_NAME=myapp',
      ].join('\n'),
    );

    const config = hubConfigModule.loadHubConfig();

    expect(config.db).toEqual({
      host: 'db.internal',
      port: 6543,
      user: 'app',
      password: 's3cret',
      database: 'myapp',
    });
  });

  it('selects embedding provider from CODE_EMBEDDING_PROVIDER', () => {
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue('CODE_EMBEDDING_PROVIDER=voyage\nVOYAGE_API_KEY=abc\n');

    const config = hubConfigModule.loadHubConfig();

    expect(config.embedding.provider).toBe('voyage');
    expect(config.embedding.userConfigured).toBe(true);
    expect(config.embedding.voyageApiKey).toBe('abc');
    expect(config.embedding.model).toBe('voyage-code-3');
    expect(config.embedding.dimensions).toBe(1024);
  });

  it('falls back to ollama when provider value is unrecognised', () => {
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue('CODE_EMBEDDING_PROVIDER=bogus\n');

    const config = hubConfigModule.loadHubConfig();

    expect(config.embedding.provider).toBe('ollama');
    expect(config.embedding.userConfigured).toBe(true);
  });

  it('honours quoted values in config.env', () => {
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue('DB_PASSWORD="my secret"\n');

    const config = hubConfigModule.loadHubConfig();

    expect(config.db.password).toBe('my secret');
  });

  it('reads jira and github credentials when present', () => {
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue(
      [
        'JIRA_URL=https://demo.atlassian.net',
        'JIRA_EMAIL=user@example.com',
        'JIRA_API_TOKEN=tok',
        'GITHUB_TOKEN=ghp_x',
      ].join('\n'),
    );

    const config = hubConfigModule.loadHubConfig();

    expect(config.credentials.jiraUrl).toBe('https://demo.atlassian.net');
    expect(config.credentials.jiraEmail).toBe('user@example.com');
    expect(config.credentials.jiraApiToken).toBe('tok');
    expect(config.credentials.githubToken).toBe('ghp_x');
  });

  it('process.env overrides config.env values', () => {
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue('DB_HOST=from-file\n');
    process.env['DB_HOST'] = 'from-process-env';

    const config = hubConfigModule.loadHubConfig();

    expect(config.db.host).toBe('from-process-env');
  });

  it('exposes optional URL fields when set', () => {
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue(
      [
        'CODE_EMBEDDING_PROVIDER=lmstudio',
        'LMSTUDIO_URL=http://localhost:1234',
        'RERANK_MODEL=qwen3-rerank',
      ].join('\n'),
    );

    const config = hubConfigModule.loadHubConfig();

    expect(config.embedding.provider).toBe('lmstudio');
    expect(config.embedding.lmstudioUrl).toBe('http://localhost:1234');
    expect(config.embedding.rerankModel).toBe('qwen3-rerank');
  });
});

describe('resetHubConfigCache', () => {
  it('forces the next loadHubConfig call to re-read the file', () => {
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue('');

    hubConfigModule.loadHubConfig();
    hubConfigModule.resetHubConfigCache();
    hubConfigModule.loadHubConfig();

    expect(readFileSync).toHaveBeenCalledTimes(2);
  });
});
