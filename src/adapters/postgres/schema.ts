import type pg from 'pg';

/**
 * Ensure all tables exist in the Argustack hub Postgres.
 *
 * Hub model: one Postgres database hosts data for many tenants
 * (workspaces). Every data table carries a `workspace_id TEXT NOT NULL
 * REFERENCES workspaces(id) ON DELETE CASCADE` column. Composite UNIQUE
 * and PRIMARY KEY constraints always include `workspace_id` first.
 *
 * Idempotent: safe to call on every CLI/MCP invocation. Re-running on a
 * populated database is a no-op. Migration from legacy per-workspace
 * databases is handled by `argustack migrate-to-hub` (H7) using a
 * separate raw-pg reader.
 */
export async function ensureSchema(pool: pg.Pool): Promise<void> {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS vector`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      display_name TEXT,
      settings JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      last_active_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_workspaces_active ON workspaces (last_active_at DESC)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS issues (
      id SERIAL PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      issue_key TEXT NOT NULL,
      issue_id TEXT,
      project_key TEXT,
      summary TEXT NOT NULL,
      description TEXT,
      issue_type VARCHAR(50),
      status VARCHAR(50),
      status_category VARCHAR(50),
      priority TEXT,
      resolution VARCHAR(50),
      assignee VARCHAR(100),
      assignee_id TEXT,
      reporter VARCHAR(100),
      reporter_id TEXT,
      created TIMESTAMP,
      updated TIMESTAMP,
      resolved TIMESTAMP,
      due_date DATE,
      labels TEXT[],
      components TEXT[],
      fix_versions TEXT[],
      parent_key TEXT,
      sprint VARCHAR(200),
      story_points NUMERIC,
      original_estimate INTEGER,
      remaining_estimate INTEGER,
      time_spent INTEGER,
      custom_fields JSONB,
      raw_json JSONB,
      embedding vector(1536),
      search_vector tsvector,
      source VARCHAR(10) DEFAULT 'jira',
      locally_modified BOOLEAN DEFAULT FALSE,
      modified_at TIMESTAMP,
      modified_fields TEXT[],
      pulled_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (workspace_id, issue_key)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS issue_comments (
      id SERIAL PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      issue_key TEXT NOT NULL,
      comment_id TEXT,
      author VARCHAR(100),
      body TEXT,
      created TIMESTAMP,
      updated TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS issue_changelogs (
      id SERIAL PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      issue_key TEXT NOT NULL,
      author VARCHAR(100),
      field VARCHAR(100),
      from_value TEXT,
      to_value TEXT,
      changed_at TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS issue_worklogs (
      id SERIAL PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      issue_key TEXT NOT NULL,
      author VARCHAR(100),
      time_spent TEXT,
      time_spent_seconds INTEGER,
      comment TEXT,
      started TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS issue_links (
      id SERIAL PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      source_key TEXT NOT NULL,
      target_key TEXT NOT NULL,
      link_type VARCHAR(50),
      direction VARCHAR(10)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS commits (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      hash VARCHAR(40) NOT NULL,
      message TEXT,
      author VARCHAR(200),
      email VARCHAR(200),
      committed_at TIMESTAMPTZ,
      parents TEXT[],
      repo_path TEXT,
      search_vector tsvector,
      pulled_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (workspace_id, hash)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS commit_files (
      id SERIAL PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      commit_hash VARCHAR(40) NOT NULL,
      file_path TEXT NOT NULL,
      status TEXT,
      additions INTEGER DEFAULT 0,
      deletions INTEGER DEFAULT 0,
      FOREIGN KEY (workspace_id, commit_hash) REFERENCES commits(workspace_id, hash) ON DELETE CASCADE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS commit_issue_refs (
      workspace_id TEXT NOT NULL,
      commit_hash VARCHAR(40) NOT NULL,
      issue_key TEXT NOT NULL,
      PRIMARY KEY (workspace_id, commit_hash, issue_key),
      FOREIGN KEY (workspace_id, commit_hash) REFERENCES commits(workspace_id, hash) ON DELETE CASCADE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS pull_requests (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      number INTEGER NOT NULL,
      repo_full_name VARCHAR(200) NOT NULL,
      title TEXT,
      body TEXT,
      state VARCHAR(10),
      author VARCHAR(200),
      created_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ,
      merged_at TIMESTAMPTZ,
      closed_at TIMESTAMPTZ,
      merge_commit_sha VARCHAR(40),
      head_ref VARCHAR(200),
      base_ref VARCHAR(200),
      labels TEXT[],
      reviewers TEXT[],
      additions INTEGER DEFAULT 0,
      deletions INTEGER DEFAULT 0,
      changed_files INTEGER DEFAULT 0,
      raw_json JSONB,
      search_vector tsvector,
      pulled_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (workspace_id, repo_full_name, number)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS pr_reviews (
      id SERIAL PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      pr_number INTEGER NOT NULL,
      repo_full_name VARCHAR(200) NOT NULL,
      review_id INTEGER NOT NULL,
      reviewer VARCHAR(200),
      state VARCHAR(30),
      body TEXT,
      submitted_at TIMESTAMPTZ,
      FOREIGN KEY (workspace_id, repo_full_name, pr_number)
        REFERENCES pull_requests(workspace_id, repo_full_name, number) ON DELETE CASCADE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS pr_comments (
      id SERIAL PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      pr_number INTEGER NOT NULL,
      repo_full_name VARCHAR(200) NOT NULL,
      comment_id BIGINT NOT NULL,
      author VARCHAR(200),
      body TEXT,
      path TEXT,
      line INTEGER,
      created_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ,
      FOREIGN KEY (workspace_id, repo_full_name, pr_number)
        REFERENCES pull_requests(workspace_id, repo_full_name, number) ON DELETE CASCADE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS pr_files (
      id SERIAL PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      pr_number INTEGER NOT NULL,
      repo_full_name VARCHAR(200) NOT NULL,
      file_path TEXT NOT NULL,
      status TEXT,
      additions INTEGER DEFAULT 0,
      deletions INTEGER DEFAULT 0,
      FOREIGN KEY (workspace_id, repo_full_name, pr_number)
        REFERENCES pull_requests(workspace_id, repo_full_name, number) ON DELETE CASCADE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS pr_issue_refs (
      workspace_id TEXT NOT NULL,
      pr_number INTEGER NOT NULL,
      repo_full_name VARCHAR(200) NOT NULL,
      issue_key TEXT NOT NULL,
      PRIMARY KEY (workspace_id, repo_full_name, pr_number, issue_key),
      FOREIGN KEY (workspace_id, repo_full_name, pr_number)
        REFERENCES pull_requests(workspace_id, repo_full_name, number) ON DELETE CASCADE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS releases (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      id INTEGER NOT NULL,
      repo_full_name VARCHAR(200) NOT NULL,
      tag_name VARCHAR(200),
      name TEXT,
      body TEXT,
      author VARCHAR(200),
      draft BOOLEAN DEFAULT FALSE,
      prerelease BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ,
      published_at TIMESTAMPTZ,
      raw_json JSONB,
      search_vector tsvector,
      pulled_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (workspace_id, repo_full_name, id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS graph_entities (
      id SERIAL PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type VARCHAR(50) NOT NULL,
      properties JSONB DEFAULT '{}',
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (workspace_id, name, type)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS graph_relationships (
      id SERIAL PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      source_id INTEGER REFERENCES graph_entities(id) ON DELETE CASCADE,
      target_id INTEGER REFERENCES graph_entities(id) ON DELETE CASCADE,
      type VARCHAR(50) NOT NULL,
      weight NUMERIC DEFAULT 1,
      source VARCHAR(20) DEFAULT 'structural',
      properties JSONB DEFAULT '{}',
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (workspace_id, source_id, target_id, type)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS graph_observations (
      id SERIAL PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      entity_id INTEGER REFERENCES graph_entities(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      author VARCHAR(50) DEFAULT 'claude',
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS db_tables (
      id SERIAL PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      source_name TEXT NOT NULL,
      table_schema TEXT,
      table_name TEXT NOT NULL,
      row_count BIGINT,
      size_bytes BIGINT,
      pulled_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (workspace_id, source_name, table_schema, table_name)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS db_columns (
      id SERIAL PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      source_name TEXT NOT NULL,
      table_schema TEXT,
      table_name TEXT NOT NULL,
      column_name TEXT NOT NULL,
      data_type TEXT,
      is_nullable BOOLEAN DEFAULT TRUE,
      default_value TEXT,
      is_primary_key BOOLEAN DEFAULT FALSE,
      ordinal_position INTEGER,
      UNIQUE (workspace_id, source_name, table_schema, table_name, column_name)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS db_foreign_keys (
      id SERIAL PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      source_name TEXT NOT NULL,
      table_name TEXT NOT NULL,
      column_name TEXT NOT NULL,
      referenced_table TEXT NOT NULL,
      referenced_column TEXT NOT NULL,
      UNIQUE (workspace_id, source_name, table_name, column_name, referenced_table, referenced_column)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS db_indexes (
      id SERIAL PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      source_name TEXT NOT NULL,
      table_name TEXT NOT NULL,
      index_name TEXT NOT NULL,
      columns TEXT[],
      is_unique BOOLEAN DEFAULT FALSE,
      is_primary BOOLEAN DEFAULT FALSE,
      UNIQUE (workspace_id, source_name, table_name, index_name)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS code_projects (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL UNIQUE REFERENCES workspaces(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      root_path TEXT NOT NULL,
      language TEXT NOT NULL,
      layer_config JSONB,
      excludes TEXT[],
      created_at TIMESTAMPTZ DEFAULT NOW(),
      last_indexed_at TIMESTAMPTZ,
      CHECK (id = workspace_id)
    )
  `);

  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_code_projects_root ON code_projects(root_path)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS code_files (
      project_id TEXT NOT NULL REFERENCES code_projects(id) ON DELETE CASCADE,
      path TEXT NOT NULL,
      hash TEXT NOT NULL,
      git_sha TEXT,
      indexed_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (project_id, path)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS code_index_jobs (
      id BIGSERIAL PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES code_projects(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TIMESTAMPTZ DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      stats JSONB,
      error TEXT
    )
  `);

  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_issues_ws ON issues (workspace_id, updated DESC)',
    'CREATE INDEX IF NOT EXISTS idx_issues_ws_project ON issues (workspace_id, project_key)',
    'CREATE INDEX IF NOT EXISTS idx_issues_ws_status ON issues (workspace_id, status)',
    'CREATE INDEX IF NOT EXISTS idx_issues_ws_type ON issues (workspace_id, issue_type)',
    'CREATE INDEX IF NOT EXISTS idx_issues_ws_assignee ON issues (workspace_id, assignee)',
    'CREATE INDEX IF NOT EXISTS idx_issues_ws_created ON issues (workspace_id, created)',
    'CREATE INDEX IF NOT EXISTS idx_issues_ws_source ON issues (workspace_id, source)',
    `CREATE INDEX IF NOT EXISTS idx_issues_ws_modified ON issues (workspace_id, locally_modified) WHERE locally_modified = true`,
    'CREATE INDEX IF NOT EXISTS idx_issues_search ON issues USING GIN(search_vector)',
    'CREATE INDEX IF NOT EXISTS idx_issues_custom ON issues USING GIN(custom_fields)',
    'CREATE INDEX IF NOT EXISTS idx_issues_raw ON issues USING GIN(raw_json)',
    'CREATE INDEX IF NOT EXISTS idx_comments_ws_key ON issue_comments (workspace_id, issue_key)',
    'CREATE INDEX IF NOT EXISTS idx_changelogs_ws_key ON issue_changelogs (workspace_id, issue_key)',
    'CREATE INDEX IF NOT EXISTS idx_worklogs_ws_key ON issue_worklogs (workspace_id, issue_key)',
    'CREATE INDEX IF NOT EXISTS idx_links_ws_source ON issue_links (workspace_id, source_key)',
    'CREATE INDEX IF NOT EXISTS idx_links_ws_target ON issue_links (workspace_id, target_key)',
    'CREATE INDEX IF NOT EXISTS idx_commits_ws_author ON commits (workspace_id, author)',
    'CREATE INDEX IF NOT EXISTS idx_commits_ws_date ON commits (workspace_id, committed_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_commits_ws_repo ON commits (workspace_id, repo_path)',
    'CREATE INDEX IF NOT EXISTS idx_commits_search ON commits USING GIN(search_vector)',
    'CREATE INDEX IF NOT EXISTS idx_commit_files_ws_hash ON commit_files (workspace_id, commit_hash)',
    'CREATE INDEX IF NOT EXISTS idx_commit_files_path ON commit_files (file_path)',
    'CREATE INDEX IF NOT EXISTS idx_commit_refs_ws_issue ON commit_issue_refs (workspace_id, issue_key)',
    'CREATE INDEX IF NOT EXISTS idx_prs_ws_repo ON pull_requests (workspace_id, repo_full_name)',
    'CREATE INDEX IF NOT EXISTS idx_prs_ws_state ON pull_requests (workspace_id, state)',
    'CREATE INDEX IF NOT EXISTS idx_prs_ws_author ON pull_requests (workspace_id, author)',
    'CREATE INDEX IF NOT EXISTS idx_prs_ws_merged ON pull_requests (workspace_id, merged_at)',
    'CREATE INDEX IF NOT EXISTS idx_prs_ws_updated ON pull_requests (workspace_id, updated_at)',
    'CREATE INDEX IF NOT EXISTS idx_prs_merge_sha ON pull_requests (merge_commit_sha)',
    'CREATE INDEX IF NOT EXISTS idx_prs_search ON pull_requests USING GIN(search_vector)',
    'CREATE INDEX IF NOT EXISTS idx_pr_reviews_pr ON pr_reviews (workspace_id, repo_full_name, pr_number)',
    'CREATE INDEX IF NOT EXISTS idx_pr_comments_pr ON pr_comments (workspace_id, repo_full_name, pr_number)',
    'CREATE INDEX IF NOT EXISTS idx_pr_files_pr ON pr_files (workspace_id, repo_full_name, pr_number)',
    'CREATE INDEX IF NOT EXISTS idx_pr_files_path ON pr_files (file_path)',
    'CREATE INDEX IF NOT EXISTS idx_pr_refs_ws_issue ON pr_issue_refs (workspace_id, issue_key)',
    'CREATE INDEX IF NOT EXISTS idx_releases_ws_repo ON releases (workspace_id, repo_full_name)',
    'CREATE INDEX IF NOT EXISTS idx_releases_tag ON releases (tag_name)',
    'CREATE INDEX IF NOT EXISTS idx_releases_search ON releases USING GIN(search_vector)',
    'CREATE INDEX IF NOT EXISTS idx_graph_entities_ws_name ON graph_entities (workspace_id, name)',
    'CREATE INDEX IF NOT EXISTS idx_graph_entities_ws_type ON graph_entities (workspace_id, type)',
    'CREATE INDEX IF NOT EXISTS idx_graph_rel_ws_source ON graph_relationships (workspace_id, source_id)',
    'CREATE INDEX IF NOT EXISTS idx_graph_rel_ws_target ON graph_relationships (workspace_id, target_id)',
    'CREATE INDEX IF NOT EXISTS idx_graph_rel_ws_type ON graph_relationships (workspace_id, type)',
    'CREATE INDEX IF NOT EXISTS idx_graph_rel_origin ON graph_relationships (source)',
    'CREATE INDEX IF NOT EXISTS idx_graph_obs_ws_entity ON graph_observations (workspace_id, entity_id)',
    'CREATE INDEX IF NOT EXISTS idx_db_tables_ws_source ON db_tables (workspace_id, source_name)',
    'CREATE INDEX IF NOT EXISTS idx_db_columns_ws_source ON db_columns (workspace_id, source_name)',
    'CREATE INDEX IF NOT EXISTS idx_db_columns_ws_table ON db_columns (workspace_id, source_name, table_name)',
    'CREATE INDEX IF NOT EXISTS idx_db_fk_ws_source ON db_foreign_keys (workspace_id, source_name)',
    'CREATE INDEX IF NOT EXISTS idx_db_indexes_ws_source ON db_indexes (workspace_id, source_name)',
    'CREATE INDEX IF NOT EXISTS idx_code_files_project ON code_files (project_id)',
    'CREATE INDEX IF NOT EXISTS idx_code_jobs_project_status ON code_index_jobs (project_id, status)',
    'CREATE INDEX IF NOT EXISTS idx_code_jobs_started ON code_index_jobs (started_at DESC)',
  ];

  for (const idx of indexes) {
    await pool.query(idx);
  }
}
