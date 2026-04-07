import type pg from 'pg';

/**
 * Ensure all tables exist. Idempotent — safe to call every time.
 */
export async function ensureSchema(pool: pg.Pool): Promise<void> {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS vector`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS issues (
      id SERIAL PRIMARY KEY,
      issue_key TEXT UNIQUE NOT NULL,
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
      pulled_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`ALTER TABLE issues ADD COLUMN IF NOT EXISTS source VARCHAR(10) DEFAULT 'jira'`);
  await pool.query(`ALTER TABLE issues ADD COLUMN IF NOT EXISTS locally_modified BOOLEAN DEFAULT FALSE`);
  await pool.query(`ALTER TABLE issues ADD COLUMN IF NOT EXISTS modified_at TIMESTAMP`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_issues_locally_modified ON issues (locally_modified) WHERE locally_modified = true`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS issue_comments (
      id SERIAL PRIMARY KEY,
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
      source_key TEXT NOT NULL,
      target_key TEXT NOT NULL,
      link_type VARCHAR(50),
      direction VARCHAR(10)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS commits (
      hash VARCHAR(40) PRIMARY KEY,
      message TEXT,
      author VARCHAR(200),
      email VARCHAR(200),
      committed_at TIMESTAMPTZ,
      parents TEXT[],
      repo_path TEXT,
      search_vector tsvector,
      pulled_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS commit_files (
      id SERIAL PRIMARY KEY,
      commit_hash VARCHAR(40) NOT NULL REFERENCES commits(hash),
      file_path TEXT NOT NULL,
      status TEXT,
      additions INTEGER DEFAULT 0,
      deletions INTEGER DEFAULT 0
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS commit_issue_refs (
      commit_hash VARCHAR(40) NOT NULL REFERENCES commits(hash),
      issue_key TEXT NOT NULL,
      PRIMARY KEY (commit_hash, issue_key)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS pull_requests (
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
      PRIMARY KEY (repo_full_name, number)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS pr_reviews (
      id SERIAL PRIMARY KEY,
      pr_number INTEGER NOT NULL,
      repo_full_name VARCHAR(200) NOT NULL,
      review_id INTEGER NOT NULL,
      reviewer VARCHAR(200),
      state VARCHAR(30),
      body TEXT,
      submitted_at TIMESTAMPTZ
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS pr_comments (
      id SERIAL PRIMARY KEY,
      pr_number INTEGER NOT NULL,
      repo_full_name VARCHAR(200) NOT NULL,
      comment_id BIGINT NOT NULL,
      author VARCHAR(200),
      body TEXT,
      path TEXT,
      line INTEGER,
      created_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS pr_files (
      id SERIAL PRIMARY KEY,
      pr_number INTEGER NOT NULL,
      repo_full_name VARCHAR(200) NOT NULL,
      file_path TEXT NOT NULL,
      status TEXT,
      additions INTEGER DEFAULT 0,
      deletions INTEGER DEFAULT 0
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS pr_issue_refs (
      pr_number INTEGER NOT NULL,
      repo_full_name VARCHAR(200) NOT NULL,
      issue_key TEXT NOT NULL,
      PRIMARY KEY (repo_full_name, pr_number, issue_key)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS releases (
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
      PRIMARY KEY (repo_full_name, id)
    )
  `);

  await pool.query(`ALTER TABLE issues ADD COLUMN IF NOT EXISTS original_estimate INTEGER`);
  await pool.query(`ALTER TABLE issues ADD COLUMN IF NOT EXISTS remaining_estimate INTEGER`);
  await pool.query(`ALTER TABLE issues ADD COLUMN IF NOT EXISTS time_spent INTEGER`);
  await pool.query(`ALTER TABLE issues ADD COLUMN IF NOT EXISTS assignee_id TEXT`);
  await pool.query(`ALTER TABLE issues ADD COLUMN IF NOT EXISTS reporter_id TEXT`);
  await pool.query(`ALTER TABLE issues ADD COLUMN IF NOT EXISTS search_vector tsvector`);
  await pool.query(`ALTER TABLE commits ADD COLUMN IF NOT EXISTS search_vector tsvector`);
  await pool.query(`ALTER TABLE pull_requests ADD COLUMN IF NOT EXISTS search_vector tsvector`);
  await pool.query(`ALTER TABLE releases ADD COLUMN IF NOT EXISTS search_vector tsvector`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS db_tables (
      id SERIAL PRIMARY KEY,
      source_name TEXT NOT NULL,
      table_schema TEXT,
      table_name TEXT NOT NULL,
      row_count BIGINT,
      size_bytes BIGINT,
      pulled_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(source_name, table_schema, table_name)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS db_columns (
      id SERIAL PRIMARY KEY,
      source_name TEXT NOT NULL,
      table_schema TEXT,
      table_name TEXT NOT NULL,
      column_name TEXT NOT NULL,
      data_type TEXT,
      is_nullable BOOLEAN DEFAULT TRUE,
      default_value TEXT,
      is_primary_key BOOLEAN DEFAULT FALSE,
      ordinal_position INTEGER,
      UNIQUE(source_name, table_schema, table_name, column_name)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS db_foreign_keys (
      id SERIAL PRIMARY KEY,
      source_name TEXT NOT NULL,
      table_name TEXT NOT NULL,
      column_name TEXT NOT NULL,
      referenced_table TEXT NOT NULL,
      referenced_column TEXT NOT NULL,
      UNIQUE(source_name, table_name, column_name, referenced_table, referenced_column)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS db_indexes (
      id SERIAL PRIMARY KEY,
      source_name TEXT NOT NULL,
      table_name TEXT NOT NULL,
      index_name TEXT NOT NULL,
      columns TEXT[],
      is_unique BOOLEAN DEFAULT FALSE,
      is_primary BOOLEAN DEFAULT FALSE,
      UNIQUE(source_name, table_name, index_name)
    )
  `);

  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_issues_project ON issues(project_key)',
    'CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status)',
    'CREATE INDEX IF NOT EXISTS idx_issues_type ON issues(issue_type)',
    'CREATE INDEX IF NOT EXISTS idx_issues_assignee ON issues(assignee)',
    'CREATE INDEX IF NOT EXISTS idx_issues_created ON issues(created)',
    'CREATE INDEX IF NOT EXISTS idx_issues_updated ON issues(updated)',
    'CREATE INDEX IF NOT EXISTS idx_issues_source ON issues(source)',
    'CREATE INDEX IF NOT EXISTS idx_issues_search ON issues USING GIN(search_vector)',
    'CREATE INDEX IF NOT EXISTS idx_issues_custom ON issues USING GIN(custom_fields)',
    'CREATE INDEX IF NOT EXISTS idx_issues_raw ON issues USING GIN(raw_json)',
    'CREATE INDEX IF NOT EXISTS idx_comments_key ON issue_comments(issue_key)',
    'CREATE INDEX IF NOT EXISTS idx_changelogs_key ON issue_changelogs(issue_key)',
    'CREATE INDEX IF NOT EXISTS idx_worklogs_key ON issue_worklogs(issue_key)',
    'CREATE INDEX IF NOT EXISTS idx_links_source ON issue_links(source_key)',
    'CREATE INDEX IF NOT EXISTS idx_links_target ON issue_links(target_key)',
    'CREATE INDEX IF NOT EXISTS idx_commits_author ON commits(author)',
    'CREATE INDEX IF NOT EXISTS idx_commits_date ON commits(committed_at)',
    'CREATE INDEX IF NOT EXISTS idx_commits_repo ON commits(repo_path)',
    'CREATE INDEX IF NOT EXISTS idx_commits_search ON commits USING GIN(search_vector)',
    'CREATE INDEX IF NOT EXISTS idx_commit_files_hash ON commit_files(commit_hash)',
    'CREATE INDEX IF NOT EXISTS idx_commit_files_path ON commit_files(file_path)',
    'CREATE INDEX IF NOT EXISTS idx_commit_refs_issue ON commit_issue_refs(issue_key)',
    'CREATE INDEX IF NOT EXISTS idx_prs_repo ON pull_requests(repo_full_name)',
    'CREATE INDEX IF NOT EXISTS idx_prs_state ON pull_requests(state)',
    'CREATE INDEX IF NOT EXISTS idx_prs_author ON pull_requests(author)',
    'CREATE INDEX IF NOT EXISTS idx_prs_merged ON pull_requests(merged_at)',
    'CREATE INDEX IF NOT EXISTS idx_prs_updated ON pull_requests(updated_at)',
    'CREATE INDEX IF NOT EXISTS idx_prs_merge_sha ON pull_requests(merge_commit_sha)',
    'CREATE INDEX IF NOT EXISTS idx_prs_search ON pull_requests USING GIN(search_vector)',
    'CREATE INDEX IF NOT EXISTS idx_pr_reviews_pr ON pr_reviews(repo_full_name, pr_number)',
    'CREATE INDEX IF NOT EXISTS idx_pr_comments_pr ON pr_comments(repo_full_name, pr_number)',
    'CREATE INDEX IF NOT EXISTS idx_pr_files_pr ON pr_files(repo_full_name, pr_number)',
    'CREATE INDEX IF NOT EXISTS idx_pr_files_path ON pr_files(file_path)',
    'CREATE INDEX IF NOT EXISTS idx_pr_refs_issue ON pr_issue_refs(issue_key)',
    'CREATE INDEX IF NOT EXISTS idx_releases_repo ON releases(repo_full_name)',
    'CREATE INDEX IF NOT EXISTS idx_releases_tag ON releases(tag_name)',
    'CREATE INDEX IF NOT EXISTS idx_releases_search ON releases USING GIN(search_vector)',
    'CREATE INDEX IF NOT EXISTS idx_db_tables_source ON db_tables(source_name)',
    'CREATE INDEX IF NOT EXISTS idx_db_columns_source ON db_columns(source_name)',
    'CREATE INDEX IF NOT EXISTS idx_db_columns_table ON db_columns(source_name, table_name)',
    'CREATE INDEX IF NOT EXISTS idx_db_fk_source ON db_foreign_keys(source_name)',
    'CREATE INDEX IF NOT EXISTS idx_db_indexes_source ON db_indexes(source_name)',
  ];

  for (const idx of indexes) {
    await pool.query(idx);
  }
}
