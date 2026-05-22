import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadProxyConfigForWorkspace,
  proxyConfigExistsForWorkspace,
  hubProxyConfigPath,
} from '../../../../src/adapters/jira-proxy/config-loader.js';
import { createProxyConfig, PROXY_TEST_IDS } from '../../../fixtures/shared/test-constants.js';

const WORKSPACE_ID = 'test-workspace';

describe('proxyConfigExistsForWorkspace', () => {
  let tmpDir: string;
  let prevHubDir: string | undefined;

  beforeEach((): void => {
    tmpDir = join(tmpdir(), `proxy-test-${String(Date.now())}-${String(Math.random())}`);
    mkdirSync(join(tmpDir, 'proxy'), { recursive: true });
    prevHubDir = process.env['ARGUSTACK_HUB_DIR'];
    process.env['ARGUSTACK_HUB_DIR'] = tmpDir;
  });

  afterEach((): void => {
    if (prevHubDir === undefined) {
      delete process.env['ARGUSTACK_HUB_DIR'];
    } else {
      process.env['ARGUSTACK_HUB_DIR'] = prevHubDir;
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns false when proxy config does not exist', (): void => {
    expect(proxyConfigExistsForWorkspace(WORKSPACE_ID)).toBe(false);
  });

  it('returns true when proxy config exists', (): void => {
    writeFileSync(hubProxyConfigPath(WORKSPACE_ID), '{}');
    expect(proxyConfigExistsForWorkspace(WORKSPACE_ID)).toBe(true);
  });
});

describe('loadProxyConfigForWorkspace', () => {
  let tmpDir: string;
  let prevHubDir: string | undefined;

  beforeEach((): void => {
    tmpDir = join(tmpdir(), `proxy-test-${String(Date.now())}-${String(Math.random())}`);
    mkdirSync(join(tmpDir, 'proxy'), { recursive: true });
    prevHubDir = process.env['ARGUSTACK_HUB_DIR'];
    process.env['ARGUSTACK_HUB_DIR'] = tmpDir;
  });

  afterEach((): void => {
    if (prevHubDir === undefined) {
      delete process.env['ARGUSTACK_HUB_DIR'];
    } else {
      process.env['ARGUSTACK_HUB_DIR'] = prevHubDir;
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loads valid proxy config', (): void => {
    const config = createProxyConfig();
    writeFileSync(hubProxyConfigPath(WORKSPACE_ID), JSON.stringify(config));

    const loaded = loadProxyConfigForWorkspace(WORKSPACE_ID);

    expect(loaded.name).toBe(PROXY_TEST_IDS.proxyName);
    expect(loaded.base_url).toBe(PROXY_TEST_IDS.baseUrl);
    expect(loaded.auth.type).toBe('bearer_exchange');
    expect(loaded.auth.service_token_env).toBe(PROXY_TEST_IDS.serviceTokenEnv);
    expect(loaded.endpoints.search.path).toBe('/search');
    expect(loaded.endpoints.issue.path).toBe('/issue/{key}');
  });

  it('throws when file does not exist', (): void => {
    expect((): void => {
      loadProxyConfigForWorkspace(WORKSPACE_ID);
    }).toThrow('Proxy config not found');
  });

  it('throws on invalid JSON', (): void => {
    writeFileSync(hubProxyConfigPath(WORKSPACE_ID), '{ invalid json');
    expect((): void => {
      loadProxyConfigForWorkspace(WORKSPACE_ID);
    }).toThrow('Invalid JSON');
  });

  it('throws when base_url is missing', (): void => {
    writeFileSync(hubProxyConfigPath(WORKSPACE_ID), JSON.stringify({ auth: {}, endpoints: {} }));
    expect((): void => {
      loadProxyConfigForWorkspace(WORKSPACE_ID);
    }).toThrow('base_url');
  });

  it('throws when auth section is missing', (): void => {
    writeFileSync(hubProxyConfigPath(WORKSPACE_ID), JSON.stringify({ base_url: 'http://x' }));
    expect((): void => {
      loadProxyConfigForWorkspace(WORKSPACE_ID);
    }).toThrow('auth');
  });

  it('throws when auth.type is invalid', (): void => {
    const config = { base_url: 'http://x', auth: { type: 'oauth', service_token_env: 'X' }, endpoints: {} };
    writeFileSync(hubProxyConfigPath(WORKSPACE_ID), JSON.stringify(config));
    expect((): void => {
      loadProxyConfigForWorkspace(WORKSPACE_ID);
    }).toThrow('auth.type must be');
  });

  it('throws when token_endpoint missing for bearer_exchange', (): void => {
    const config = {
      base_url: 'http://x',
      auth: { type: 'bearer_exchange', service_token_env: 'X' },
      endpoints: { search: { path: '/s' }, issue: { path: '/i' }, projects: { path: '/p' }, fields: { path: '/f' } },
    };
    writeFileSync(hubProxyConfigPath(WORKSPACE_ID), JSON.stringify(config));
    expect((): void => {
      loadProxyConfigForWorkspace(WORKSPACE_ID);
    }).toThrow('token_endpoint is required');
  });

  it('throws when required endpoint is missing', (): void => {
    const config = {
      base_url: 'http://x',
      auth: { type: 'bearer', service_token_env: 'X' },
      endpoints: { search: { path: '/s' } },
    };
    writeFileSync(hubProxyConfigPath(WORKSPACE_ID), JSON.stringify(config));
    expect((): void => {
      loadProxyConfigForWorkspace(WORKSPACE_ID);
    }).toThrow('endpoints.issue');
  });

  it('loads config with optional response_mapping', (): void => {
    const config = createProxyConfig({
      response_mapping: { issue_key: 'ticket', summary: 'title' },
    });
    writeFileSync(hubProxyConfigPath(WORKSPACE_ID), JSON.stringify(config));

    const loaded = loadProxyConfigForWorkspace(WORKSPACE_ID);
    expect(loaded.response_mapping).toEqual({ issue_key: 'ticket', summary: 'title' });
  });

  it('loads config with optional headers', (): void => {
    const config = createProxyConfig({
      headers: { 'X-Custom': 'value' },
    });
    writeFileSync(hubProxyConfigPath(WORKSPACE_ID), JSON.stringify(config));

    const loaded = loadProxyConfigForWorkspace(WORKSPACE_ID);
    expect(loaded.headers).toEqual({ 'X-Custom': 'value' });
  });

  it('accepts bearer auth without token_endpoint', (): void => {
    const config = createProxyConfig({
      auth: { type: 'bearer', service_token_env: 'MY_TOKEN' },
    });
    writeFileSync(hubProxyConfigPath(WORKSPACE_ID), JSON.stringify(config));

    const loaded = loadProxyConfigForWorkspace(WORKSPACE_ID);
    expect(loaded.auth.type).toBe('bearer');
  });
});
