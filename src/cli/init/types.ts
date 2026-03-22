import { resolve } from 'node:path';

export interface JiraSetupResult {
  jiraUrl: string;
  jiraEmail: string;
  jiraToken: string;
  jiraProjects: string[];
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

export interface InitFlags {
  dir?: string;
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
  csvFile?: string;
  dbPort?: string;
  pgwebPort?: string;
  interactive?: boolean;
}

const DEFAULT_DB_PORT = 5434;
const DEFAULT_PGWEB_PORT = 8086;

export { DEFAULT_DB_PORT, DEFAULT_PGWEB_PORT };

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
export function extractJiraBaseUrl(raw: string): string {
  try {
    const url = new URL(raw.trim());
    return `${url.protocol}//${url.host}`;
  } catch {
    return raw.trim().replace(/\/+$/, '');
  }
}
