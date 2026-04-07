import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadProxyConfig, proxyConfigExists } from '../../../../src/adapters/jira-proxy/config-loader.js';
import { createProxyConfig, PROXY_TEST_IDS } from '../../../fixtures/shared/test-constants.js';

describe('proxyConfigExists', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `proxy-test-${String(Date.now())}`);
    mkdirSync(join(tmpDir, '.argustack'), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns false when proxy.json does not exist', () => {
    expect(proxyConfigExists(tmpDir)).toBe(false);
  });

  it('returns true when proxy.json exists', () => {
    writeFileSync(join(tmpDir, '.argustack/proxy.json'), '{}');
    expect(proxyConfigExists(tmpDir)).toBe(true);
  });
});

describe('loadProxyConfig', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `proxy-test-${String(Date.now())}`);
    mkdirSync(join(tmpDir, '.argustack'), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loads valid proxy config', () => {
    const config = createProxyConfig();
    writeFileSync(join(tmpDir, '.argustack/proxy.json'), JSON.stringify(config));

    const loaded = loadProxyConfig(tmpDir);

    expect(loaded.name).toBe(PROXY_TEST_IDS.proxyName);
    expect(loaded.base_url).toBe(PROXY_TEST_IDS.baseUrl);
    expect(loaded.auth.type).toBe('bearer_exchange');
    expect(loaded.auth.service_token_env).toBe(PROXY_TEST_IDS.serviceTokenEnv);
    expect(loaded.endpoints.search.path).toBe('/search');
    expect(loaded.endpoints.issue.path).toBe('/issue/{key}');
  });

  it('throws when file does not exist', () => {
    expect(() => loadProxyConfig(tmpDir)).toThrow('Proxy config not found');
  });

  it('throws on invalid JSON', () => {
    writeFileSync(join(tmpDir, '.argustack/proxy.json'), '{ invalid json');
    expect(() => loadProxyConfig(tmpDir)).toThrow('Invalid JSON');
  });

  it('throws when base_url is missing', () => {
    writeFileSync(join(tmpDir, '.argustack/proxy.json'), JSON.stringify({ auth: {}, endpoints: {} }));
    expect(() => loadProxyConfig(tmpDir)).toThrow('base_url');
  });

  it('throws when auth section is missing', () => {
    writeFileSync(join(tmpDir, '.argustack/proxy.json'), JSON.stringify({ base_url: 'http://x' }));
    expect(() => loadProxyConfig(tmpDir)).toThrow('auth');
  });

  it('throws when auth.type is invalid', () => {
    const config = { base_url: 'http://x', auth: { type: 'oauth', service_token_env: 'X' }, endpoints: {} };
    writeFileSync(join(tmpDir, '.argustack/proxy.json'), JSON.stringify(config));
    expect(() => loadProxyConfig(tmpDir)).toThrow('auth.type must be');
  });

  it('throws when token_endpoint missing for bearer_exchange', () => {
    const config = {
      base_url: 'http://x',
      auth: { type: 'bearer_exchange', service_token_env: 'X' },
      endpoints: { search: { path: '/s' }, issue: { path: '/i' }, projects: { path: '/p' }, fields: { path: '/f' } },
    };
    writeFileSync(join(tmpDir, '.argustack/proxy.json'), JSON.stringify(config));
    expect(() => loadProxyConfig(tmpDir)).toThrow('token_endpoint is required');
  });

  it('throws when required endpoint is missing', () => {
    const config = {
      base_url: 'http://x',
      auth: { type: 'bearer', service_token_env: 'X' },
      endpoints: { search: { path: '/s' } },
    };
    writeFileSync(join(tmpDir, '.argustack/proxy.json'), JSON.stringify(config));
    expect(() => loadProxyConfig(tmpDir)).toThrow('endpoints.issue');
  });

  it('loads config with optional response_mapping', () => {
    const config = createProxyConfig({
      response_mapping: { issue_key: 'ticket', summary: 'title' },
    });
    writeFileSync(join(tmpDir, '.argustack/proxy.json'), JSON.stringify(config));

    const loaded = loadProxyConfig(tmpDir);
    expect(loaded.response_mapping).toEqual({ issue_key: 'ticket', summary: 'title' });
  });

  it('loads config with optional headers', () => {
    const config = createProxyConfig({
      headers: { 'X-Custom': 'value' },
    });
    writeFileSync(join(tmpDir, '.argustack/proxy.json'), JSON.stringify(config));

    const loaded = loadProxyConfig(tmpDir);
    expect(loaded.headers).toEqual({ 'X-Custom': 'value' });
  });

  it('accepts bearer auth without token_endpoint', () => {
    const config = createProxyConfig({
      auth: { type: 'bearer', service_token_env: 'MY_TOKEN' },
    });
    writeFileSync(join(tmpDir, '.argustack/proxy.json'), JSON.stringify(config));

    const loaded = loadProxyConfig(tmpDir);
    expect(loaded.auth.type).toBe('bearer');
  });
});
