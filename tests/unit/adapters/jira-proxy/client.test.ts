import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProxyClient } from '../../../../src/adapters/jira-proxy/client.js';
import { createProxyConfig, PROXY_TEST_IDS } from '../../../fixtures/shared/test-constants.js';

describe('ProxyClient', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, [PROXY_TEST_IDS.serviceTokenEnv]: 'test-service-token' };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe('authenticate — bearer', () => {
    it('returns service token directly', async () => {
      const config = createProxyConfig({
        auth: { type: 'bearer', service_token_env: PROXY_TEST_IDS.serviceTokenEnv },
      });
      const client = new ProxyClient(config);

      const token = await client.authenticate();
      expect(token).toBe('test-service-token');
    });

    it('throws when env var is not set', async () => {
      process.env[PROXY_TEST_IDS.serviceTokenEnv] = '';
      const config = createProxyConfig({
        auth: { type: 'bearer', service_token_env: PROXY_TEST_IDS.serviceTokenEnv },
      });
      const client = new ProxyClient(config);

      await expect(client.authenticate()).rejects.toThrow(PROXY_TEST_IDS.serviceTokenEnv);
    });
  });

  describe('authenticate — bearer_exchange', () => {
    it('exchanges service token for access token', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'short-lived-token' }), { status: 200 }),
      );

      const config = createProxyConfig();
      const client = new ProxyClient(config);

      const token = await client.authenticate();
      expect(token).toBe('short-lived-token');
      expect(fetchSpy).toHaveBeenCalledWith(
        `${new URL(PROXY_TEST_IDS.baseUrl).origin}${PROXY_TEST_IDS.tokenEndpoint}`,
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('caches token within TTL', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ access_token: 'cached-token' }), { status: 200 }),
      );

      const config = createProxyConfig();
      const client = new ProxyClient(config);

      await client.authenticate();
      await client.authenticate();

      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('throws on exchange failure', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('Unauthorized', { status: 401 }),
      );

      const config = createProxyConfig();
      const client = new ProxyClient(config);

      await expect(client.authenticate()).rejects.toThrow('Token exchange failed');
    });

    it('throws when response has no token field', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ something_else: 'value' }), { status: 200 }),
      );

      const config = createProxyConfig();
      const client = new ProxyClient(config);

      await expect(client.authenticate()).rejects.toThrow('missing access_token');
    });
  });

  describe('fetch', () => {
    it('makes authenticated GET request', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ issues: [] }), { status: 200 }));

      const config = createProxyConfig();
      const client = new ProxyClient(config);

      const result = await client.fetch('/search', { jql: 'project = TEST' });
      expect(result).toEqual({ issues: [] });

      const lastCall = fetchSpy.mock.calls.at(1) ?? [];
      expect(lastCall[0]).toContain('/search?jql=');
      expect((lastCall[1]?.headers as Record<string, string>)['Authorization']).toBe('Bearer tok');
    });

    it('retries on 401', async () => {
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'tok1' }), { status: 200 }))
        .mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'tok2' }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

      const config = createProxyConfig();
      const client = new ProxyClient(config);

      const result = await client.fetch('/test');
      expect(result).toEqual({ ok: true });
    });

    it('throws on non-ok response', async () => {
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 }))
        .mockResolvedValueOnce(new Response('Not Found', { status: 404, statusText: 'Not Found' }));

      const config = createProxyConfig();
      const client = new ProxyClient(config);

      await expect(client.fetch('/missing')).rejects.toThrow('404');
    });

    it('includes custom headers from config', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));

      const config = createProxyConfig({ headers: { 'X-Custom': 'test-value' } });
      const client = new ProxyClient(config);

      await client.fetch('/test');

      const lastCall = fetchSpy.mock.calls.at(1) ?? [];
      expect((lastCall[1]?.headers as Record<string, string>)['X-Custom']).toBe('test-value');
    });
  });
});
