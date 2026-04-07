import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ProxyConfig } from '../../core/types/proxy-config.js';

const PROXY_CONFIG_PATH = '.argustack/proxy.json';

export function proxyConfigExists(workspaceRoot: string): boolean {
  return existsSync(join(workspaceRoot, PROXY_CONFIG_PATH));
}

export function loadProxyConfig(workspaceRoot: string): ProxyConfig {
  const filePath = join(workspaceRoot, PROXY_CONFIG_PATH);

  if (!existsSync(filePath)) {
    throw new Error(`Proxy config not found: ${filePath}`);
  }

  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch (err: unknown) {
    throw new Error(`Failed to read proxy config: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: unknown) {
    throw new Error(`Invalid JSON in proxy config (${filePath}): ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }

  return validateProxyConfig(parsed);
}

function validateProxyConfig(raw: unknown): ProxyConfig {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Proxy config must be a JSON object');
  }

  const obj = raw as Record<string, unknown>;

  if (typeof obj['base_url'] !== 'string' || obj['base_url'].length === 0) {
    throw new Error('Proxy config: "base_url" is required (non-empty string)');
  }

  if (typeof obj['auth'] !== 'object' || obj['auth'] === null) {
    throw new Error('Proxy config: "auth" section is required');
  }

  const auth = obj['auth'] as Record<string, unknown>;
  if (auth['type'] !== 'bearer' && auth['type'] !== 'bearer_exchange') {
    throw new Error('Proxy config: auth.type must be "bearer" or "bearer_exchange"');
  }

  if (typeof auth['service_token_env'] !== 'string' || auth['service_token_env'].length === 0) {
    throw new Error('Proxy config: auth.service_token_env is required');
  }

  if (auth['type'] === 'bearer_exchange') {
    if (typeof auth['token_endpoint'] !== 'string' || auth['token_endpoint'].length === 0) {
      throw new Error('Proxy config: auth.token_endpoint is required for bearer_exchange');
    }
  }

  if (typeof obj['endpoints'] !== 'object' || obj['endpoints'] === null) {
    throw new Error('Proxy config: "endpoints" section is required');
  }

  const endpoints = obj['endpoints'] as Record<string, unknown>;
  for (const key of ['search', 'issue', 'projects', 'fields']) {
    const ep = endpoints[key];
    if (typeof ep !== 'object' || ep === null) {
      throw new Error(`Proxy config: endpoints.${key} is required`);
    }
    const epObj = ep as Record<string, unknown>;
    if (typeof epObj['path'] !== 'string') {
      throw new Error(`Proxy config: endpoints.${key}.path is required`);
    }
  }

  const config: ProxyConfig = {
    name: typeof obj['name'] === 'string' ? obj['name'] : 'Proxy',
    base_url: obj['base_url'],
    auth: {
      type: auth['type'],
      service_token_env: auth['service_token_env'],
      ...(typeof auth['token_endpoint'] === 'string' ? { token_endpoint: auth['token_endpoint'] } : {}),
      ...(typeof auth['ttl_minutes'] === 'number' ? { ttl_minutes: auth['ttl_minutes'] } : {}),
    },
    endpoints: {
      search: parseEndpoint(endpoints['search'] as Record<string, unknown>),
      issue: parseEndpoint(endpoints['issue'] as Record<string, unknown>),
      projects: parseEndpoint(endpoints['projects'] as Record<string, unknown>),
      fields: parseEndpoint(endpoints['fields'] as Record<string, unknown>),
    },
  };

  if (typeof obj['description'] === 'string') {
    config.description = obj['description'];
  }

  if (typeof obj['response_mapping'] === 'object' && obj['response_mapping'] !== null) {
    const mapping: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj['response_mapping'] as Record<string, unknown>)) {
      if (typeof v === 'string') {
        mapping[k] = v;
      }
    }
    config.response_mapping = mapping;
  }

  if (typeof obj['headers'] === 'object' && obj['headers'] !== null) {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj['headers'] as Record<string, unknown>)) {
      if (typeof v === 'string') {
        headers[k] = v;
      }
    }
    config.headers = headers;
  }

  return config;
}

export function buildDefaultProxyConfig(baseUrl: string, serviceTokenEnv = 'JIRA_PROXY_TOKEN'): ProxyConfig {
  return {
    name: 'Jira Proxy',
    base_url: baseUrl.replace(/\/+$/, ''),
    auth: {
      type: 'bearer_exchange',
      token_endpoint: '/service/auth/exchange',
      service_token_env: serviceTokenEnv,
      ttl_minutes: 15,
    },
    endpoints: {
      search: { path: '/search', method: 'GET', params: ['jql', 'fields', 'maxResults', 'startAt'] },
      issue: { path: '/issue/{key}', method: 'GET' },
      projects: { path: '/project/search', method: 'GET', params: ['maxResults', 'startAt', 'query'] },
      fields: { path: '/field', method: 'GET' },
    },
  };
}

function parseEndpoint(raw: Record<string, unknown>): { path: string; method: 'GET' | 'POST'; params?: string[] } {
  const method = raw['method'] === 'POST' ? 'POST' as const : 'GET' as const;
  const result: { path: string; method: 'GET' | 'POST'; params?: string[] } = {
    path: raw['path'] as string,
    method,
  };
  if (Array.isArray(raw['params'])) {
    result.params = raw['params'].filter((p): p is string => typeof p === 'string');
  }
  return result;
}
