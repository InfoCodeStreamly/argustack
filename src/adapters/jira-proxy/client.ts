import type { ProxyConfig } from '../../core/types/proxy-config.js';

export class ProxyClient {
  private readonly config: ProxyConfig;
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(config: ProxyConfig) {
    this.config = config;
  }

  async fetch(endpointPath: string, params?: Record<string, string>): Promise<unknown> {
    const token = await this.authenticate();
    const url = this.buildUrl(endpointPath, params);

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
      ...this.config.headers,
    };

    const response = await globalThis.fetch(url, {
      method: 'GET',
      headers,
    });

    if (response.status === 401) {
      this.accessToken = null;
      this.tokenExpiresAt = 0;
      const retryToken = await this.authenticate();
      const retryResponse = await globalThis.fetch(url, {
        method: 'GET',
        headers: { ...headers, 'Authorization': `Bearer ${retryToken}` },
      });
      if (!retryResponse.ok) {
        throw new Error(`Proxy request failed after re-auth: ${String(retryResponse.status)} ${retryResponse.statusText}`);
      }
      return retryResponse.json();
    }

    if (!response.ok) {
      throw new Error(`Proxy request failed: ${String(response.status)} ${response.statusText} — ${url}`);
    }

    return response.json();
  }

  async authenticate(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) {
      return this.accessToken;
    }

    const serviceToken = process.env[this.config.auth.service_token_env] ?? '';
    if (serviceToken.length === 0) {
      throw new Error(`Environment variable ${this.config.auth.service_token_env} is not set`);
    }

    if (this.config.auth.type === 'bearer') {
      this.accessToken = serviceToken;
      this.tokenExpiresAt = Number.MAX_SAFE_INTEGER;
      return serviceToken;
    }

    const tokenEndpoint = this.config.auth.token_endpoint;
    if (!tokenEndpoint) {
      throw new Error('Token endpoint is required for bearer_exchange auth');
    }

    const origin = new URL(this.config.base_url).origin;
    const exchangeUrl = `${origin}${tokenEndpoint}`;

    const response = await globalThis.fetch(exchangeUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceToken}`,
        'Accept': 'application/json',
        ...this.config.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`Token exchange failed at ${tokenEndpoint}: ${String(response.status)} ${response.statusText}. Check ${this.config.auth.service_token_env}.`);
    }

    const body = await response.json() as Record<string, unknown>;
    const token = (body['access_token'] ?? body['token'] ?? body['accessToken']) as string | undefined;
    if (!token) {
      throw new Error('Token exchange response missing access_token field');
    }

    this.accessToken = token;
    const ttlMs = (this.config.auth.ttl_minutes ?? 15) * 60 * 1000;
    this.tokenExpiresAt = Date.now() + ttlMs - 30_000;

    return token;
  }

  private buildUrl(endpointPath: string, params?: Record<string, string>): string {
    const base = `${this.config.base_url}${endpointPath}`;
    if (!params || Object.keys(params).length === 0) {
      return base;
    }
    const searchParams = new URLSearchParams(params);
    return `${base}?${searchParams.toString()}`;
  }
}
