import { describe, it, expect } from 'vitest';
import { createProxyConfig, PROXY_TEST_IDS } from '../../../fixtures/shared/test-constants.js';

describe('ProxyConfig types', () => {
  it('createProxyConfig returns valid default config', () => {
    const config = createProxyConfig();

    expect(config.name).toBe(PROXY_TEST_IDS.proxyName);
    expect(config.base_url).toBe(PROXY_TEST_IDS.baseUrl);
    expect(config.auth.type).toBe('bearer_exchange');
    expect(config.auth.service_token_env).toBe(PROXY_TEST_IDS.serviceTokenEnv);
    expect(config.endpoints.search.path).toBe('/search');
    expect(config.endpoints.issue.path).toBe('/issue/{key}');
    expect(config.endpoints.projects.path).toBe('/project/search');
    expect(config.endpoints.fields.path).toBe('/field');
  });

  it('createProxyConfig accepts overrides', () => {
    const config = createProxyConfig({
      name: 'Custom',
      base_url: 'https://custom.test',
      headers: { 'X-Custom': 'value' },
    });

    expect(config.name).toBe('Custom');
    expect(config.base_url).toBe('https://custom.test');
    expect(config.headers).toEqual({ 'X-Custom': 'value' });
    expect(config.auth.type).toBe('bearer_exchange');
  });

  it('supports bearer auth type', () => {
    const config = createProxyConfig({
      auth: { type: 'bearer', service_token_env: 'MY_TOKEN' },
    });

    expect(config.auth.type).toBe('bearer');
    expect(config.auth.token_endpoint).toBeUndefined();
  });

  it('supports optional response_mapping', () => {
    const config = createProxyConfig({
      response_mapping: { issue_key: 'ticket', summary: 'title' },
    });

    expect(config.response_mapping).toEqual({ issue_key: 'ticket', summary: 'title' });
  });
});
