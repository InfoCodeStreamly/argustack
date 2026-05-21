-- Argustack Hub schema (reference / manual verification)
--
-- This file mirrors what `ensureSchema()` in
-- `src/adapters/postgres/schema.ts` creates programmatically. Keep
-- the two in sync. Use this file for:
--   * `psql -f migrate-to-hub.sql` on a fresh database to bootstrap
--     the hub without running the Node CLI
--   * Reviewing constraints during code review
--   * Verifying a running hub against the expected DDL
--
-- Tenant model: every data table carries
--   workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE
-- Composite UNIQUE / PRIMARY KEY constraints always lead with workspace_id.
-- ARG-264 (ARG-264.md) is the source of truth for the multi-tenant design.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  display_name TEXT,
  settings JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_active_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_workspaces_active ON workspaces (last_active_at DESC);

-- ===== Issues domain =====

CREATE TABLE IF NOT EXISTS issues (
  id SERIAL PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  issue_key TEXT NOT NULL,
  -- ... (see schema.ts for full column list)
  UNIQUE (workspace_id, issue_key)
);

-- ===== Commits domain =====

CREATE TABLE IF NOT EXISTS commits (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  hash VARCHAR(40) NOT NULL,
  -- ...
  PRIMARY KEY (workspace_id, hash)
);

-- ===== Pull Requests domain =====

CREATE TABLE IF NOT EXISTS pull_requests (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  repo_full_name VARCHAR(200) NOT NULL,
  -- ...
  PRIMARY KEY (workspace_id, repo_full_name, number)
);

-- ===== Graph domain =====

CREATE TABLE IF NOT EXISTS graph_entities (
  id SERIAL PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type VARCHAR(50) NOT NULL,
  UNIQUE (workspace_id, name, type)
);

-- ===== External DB schema cache =====

CREATE TABLE IF NOT EXISTS db_tables (
  id SERIAL PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_name TEXT NOT NULL,
  table_schema TEXT,
  table_name TEXT NOT NULL,
  UNIQUE (workspace_id, source_name, table_schema, table_name)
);

-- ===== Code Intelligence =====

CREATE TABLE IF NOT EXISTS code_projects (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL UNIQUE REFERENCES workspaces(id) ON DELETE CASCADE,
  CHECK (id = workspace_id),
  name TEXT NOT NULL,
  root_path TEXT NOT NULL,
  language TEXT NOT NULL
);

-- See src/adapters/postgres/schema.ts for the canonical, full DDL of
-- all 24 tenant tables, indexes, and composite foreign keys.
