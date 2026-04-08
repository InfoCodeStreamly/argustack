import { resolve } from 'node:path';
import { createServer } from 'node:net';

export interface JiraSetupResult {
  jiraUrl: string;
  jiraEmail: string;
  jiraToken: string;
  jiraProjects: string[];
  issueTypes?: string[];
  issueTypeIds?: string[];
}

export interface GitSetupResult {
  gitRepoPaths: string[];
  githubToken?: string;
  githubRepos?: string[];
}

export interface GitHubSetupResult {
  githubToken: string;
  githubOwner: string;
  githubRepo: string;
}

export interface CsvSetupResult {
  csvFilePath: string;
}

export interface DbSetupResult {
  targetDbEngine: string;
  targetDbHost: string;
  targetDbPort: number;
  targetDbUser: string;
  targetDbPassword: string;
  targetDbName: string;
}

export interface ProxySetupResult {
  proxyUrl: string;
  proxyToken: string;
  jiraProjects: string[];
  issueTypes?: string[];
  issueTypeIds?: string[];
}

export interface InitFlags {
  name?: string;
  source?: string;
  jiraUrl?: string;
  jiraEmail?: string;
  jiraToken?: string;
  jiraProjects?: string;
  gitRepo?: string;
  githubToken?: string;
  githubOwner?: string;
  githubRepo?: string;
  targetDbEngine?: string;
  targetDbHost?: string;
  targetDbPort?: string;
  targetDbUser?: string;
  targetDbPassword?: string;
  targetDbName?: string;
  proxyUrl?: string;
  proxyToken?: string;
  csvFile?: string;
  dbPort?: string;
  pgwebPort?: string;
  interactive?: boolean;
}

const DEFAULT_DB_PORT = 5434;
const DEFAULT_PGWEB_PORT = 8086;

export { DEFAULT_DB_PORT, DEFAULT_PGWEB_PORT };

export function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((res) => {
    const server = createServer();
    server.once('error', () => { res(false); });
    server.once('listening', () => { server.close(() => { res(true); }); });
    server.listen(port, '0.0.0.0');
  });
}

export async function findAvailablePort(basePort: number, maxAttempts = 10): Promise<number> {
  for (let i = 0; i < maxAttempts; i++) {
    const port = basePort + i;
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found in range ${String(basePort)}-${String(basePort + maxAttempts - 1)}`);
}

export function getErrorMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function resolvePath(raw: string): string {
  return resolve(raw.trim().replace(/^~/, process.env['HOME'] ?? '~'));
}

export function validatePort(val: string, min = 1): string | true {
  const n = parseInt(val, 10);
  if (isNaN(n) || n < min || n > 65535) {
    return `Port must be ${String(min)}-65535`;
  }
  return true;
}

/**
 * Strip path, query, fragment from a Jira URL.
 * User may paste full board URL — we only need the base.
 */
/**
 * Mask sensitive string for display: show first 2 + last chars, mask middle.
 * Email: in****@co**********.com
 */
export function maskEmail(email: string): string {
  const [user, domain] = email.split('@');
  if (!user || !domain) {
    return '****';
  }
  const prefix = user.slice(0, 2);
  const maskedUser = prefix + '*'.repeat(Math.max(user.length - 2, 4));

  const dotIdx = domain.lastIndexOf('.');
  if (dotIdx <= 0) {
    return `${maskedUser}@${'*'.repeat(domain.length)}`;
  }
  const domainName = domain.slice(0, dotIdx);
  const tld = domain.slice(dotIdx);
  const domainPrefix = domainName.slice(0, 2);
  const maskedDomain = domainPrefix + '*'.repeat(Math.max(domainName.length - 2, 4)) + tld;

  return `${maskedUser}@${maskedDomain}`;
}

export function maskHost(host: string): string {
  const parts = host.split('.');
  if (parts.length < 2) {return host;}
  return parts.map((part, i) => {
    if (i === parts.length - 1) {return part;}
    if (part.length <= 2) {return part;}
    return part.slice(0, 2) + '*'.repeat(Math.min(part.length - 2, 10));
  }).join('.');
}

export function maskOrgRepo(owner: string, repo?: string): string {
  const full = repo ? `${owner}/${repo}` : owner;
  const parts = full.split('/');
  const o = parts[0] ?? '';
  const r = parts[1] ?? '';
  const maskedO = o.length <= 2 ? o : o.slice(0, 2) + '*'.repeat(Math.min(o.length - 2, 10));
  if (!r) {return maskedO;}
  const maskedR = r.length <= 2 ? r : r.slice(0, 2) + '*'.repeat(Math.min(r.length - 2, 10));
  return `${maskedO}/${maskedR}`;
}

export function maskPath(p: string): string {
  const parts = p.split('/');
  const last = parts.pop() ?? '';
  const maskedLast = last.length <= 2 ? last : last.slice(0, 2) + '*'.repeat(Math.min(last.length - 2, 10));
  return [...parts, maskedLast].join('/');
}

export function extractJiraBaseUrl(raw: string): string {
  try {
    const url = new URL(raw.trim());
    return `${url.protocol}//${url.host}`;
  } catch {
    return raw.trim().replace(/\/+$/, '');
  }
}
