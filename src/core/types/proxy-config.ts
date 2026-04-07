export interface ProxyAuth {
  type: 'bearer' | 'bearer_exchange';
  token_endpoint?: string;
  service_token_env: string;
  ttl_minutes?: number;
}

export interface ProxyEndpoint {
  path: string;
  method: 'GET' | 'POST';
  params?: string[];
}

export interface ProxyEndpoints {
  search: ProxyEndpoint;
  issue: ProxyEndpoint;
  projects: ProxyEndpoint;
  fields: ProxyEndpoint;
}

export type ProxyFieldMapping = Record<string, string>;

export interface ProxyConfig {
  name: string;
  description?: string;
  base_url: string;
  auth: ProxyAuth;
  endpoints: ProxyEndpoints;
  response_mapping?: ProxyFieldMapping;
  headers?: Record<string, string>;
}
