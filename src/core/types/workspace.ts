import type { DbEngine } from './database.js';

/**
 * DB source configuration stored per workspace.
 *
 * Stored as part of {@link WorkspaceSettings.dbConfigs} in the
 * `workspaces.settings` JSONB column. Credentials never leave the
 * workspace settings record — they are not written to the global
 * `~/.argustack/config.env`.
 */
export interface DbSourceConfig {
  readonly name: string;
  readonly engine: DbEngine;
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly database: string;
  readonly schema?: string;
  readonly ssl?: boolean;
}

/**
 * GitHub repository binding stored per workspace.
 * The personal access token lives in `~/.argustack/config.env`
 * (single token per machine); the per-workspace setting tracks only
 * which `owner/repo` pairs to sync.
 */
export interface GitHubRepoConfig {
  readonly owner: string;
  readonly repo: string;
}

/**
 * CSV file binding stored per workspace.
 * Path must be absolute; relative paths break when sync is invoked from
 * an arbitrary working directory.
 */
export interface CsvFileConfig {
  readonly path: string;
}

/**
 * Workspace-scoped, per-source bindings.
 *
 * Stored in the `workspaces.settings` JSONB column. Credentials
 * (Jira token, GitHub PAT, OpenAI/Voyage keys) are not stored here —
 * they live in `~/.argustack/config.env` because there is exactly one
 * value per machine.
 *
 * Per-workspace data lives here because it differs per workspace:
 *  - Jira project keys (PROJ vs OTHER)
 *  - Local git repository paths
 *  - GitHub `owner/repo` targets
 *  - CSV file paths
 *  - External DB connection info
 */
export interface WorkspaceSettings {
  readonly jiraProjectKeys?: readonly string[];
  readonly gitRepoPaths?: readonly string[];
  readonly githubRepos?: readonly GitHubRepoConfig[];
  readonly csvFilePaths?: readonly CsvFileConfig[];
  readonly dbConfigs?: readonly DbSourceConfig[];
}

/**
 * Tenant identity in the hub-Postgres model.
 *
 * `id` is the slug used as the foreign key on every other table
 * (`workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE`).
 *
 * Invariant: `workspaces.id === code_projects.id` for code-indexed
 * workspaces — enforced by FK on `code_projects.workspace_id`.
 */
export interface Workspace {
  readonly id: string;
  readonly name: string;
  readonly displayName?: string;
  readonly createdAt?: string;
  readonly lastActiveAt?: string;
  readonly settings?: WorkspaceSettings;
}
