import type pg from 'pg';

/**
 * Ensure all tables exist. Idempotent — safe to call every time.
 */
export async function ensureSchema(pool: pg.Pool): Promise<void> {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS vector`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS issues (
      id SERIAL PRIMARY KEY,
      issue_key VARCHAR(20) UNIQUE NOT NULL,
      issue_id VARCHAR(20),
      project_key VARCHAR(20),
      summary TEXT NOT NULL,
      description TEXT,
      issue_type VARCHAR(50),
      status VARCHAR(50),
      status_category VARCHAR(50),
      priority VARCHAR(20),
      resolution VARCHAR(50),
      assignee VARCHAR(100),
      reporter VARCHAR(100),
      created TIMESTAMP,
      updated TIMESTAMP,
      resolved TIMESTAMP,
      due_date DATE,
      labels TEXT[],
      components TEXT[],
      fix_versions TEXT[],
      parent_key VARCHAR(20),
      sprint VARCHAR(200),
      story_points NUMERIC,
      custom_fields JSONB,
      raw_json JSONB,
      embedding vector(1536),
      search_vector tsvector,
      pulled_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS issue_comments (
      id SERIAL PRIMARY KEY,
      issue_key VARCHAR(20) NOT NULL,
      comment_id VARCHAR(20),
      author VARCHAR(100),
      body TEXT,
      created TIMESTAMP,
      updated TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS issue_changelogs (
      id SERIAL PRIMARY KEY,
      issue_key VARCHAR(20) NOT NULL,
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
      issue_key VARCHAR(20) NOT NULL,
      author VARCHAR(100),
      time_spent VARCHAR(20),
      time_spent_seconds INTEGER,
      comment TEXT,
      started TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS issue_links (
      id SERIAL PRIMARY KEY,
      source_key VARCHAR(20) NOT NULL,
      target_key VARCHAR(20) NOT NULL,
      link_type VARCHAR(50),
      direction VARCHAR(10)
    )
  `);

  // ─── Git tables ───────────────────────────────────────────────────────

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
      status VARCHAR(20),
      additions INTEGER DEFAULT 0,
      deletions INTEGER DEFAULT 0
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS commit_issue_refs (
      commit_hash VARCHAR(40) NOT NULL REFERENCES commits(hash),
      issue_key VARCHAR(20) NOT NULL,
      PRIMARY KEY (commit_hash, issue_key)
    )
  `);

  // ─── Indexes ──────────────────────────────────────────────────────────

  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_issues_project ON issues(project_key)',
    'CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status)',
    'CREATE INDEX IF NOT EXISTS idx_issues_type ON issues(issue_type)',
    'CREATE INDEX IF NOT EXISTS idx_issues_assignee ON issues(assignee)',
    'CREATE INDEX IF NOT EXISTS idx_issues_created ON issues(created)',
    'CREATE INDEX IF NOT EXISTS idx_issues_updated ON issues(updated)',
    'CREATE INDEX IF NOT EXISTS idx_issues_search ON issues USING GIN(search_vector)',
    'CREATE INDEX IF NOT EXISTS idx_issues_custom ON issues USING GIN(custom_fields)',
    'CREATE INDEX IF NOT EXISTS idx_issues_raw ON issues USING GIN(raw_json)',
    'CREATE INDEX IF NOT EXISTS idx_comments_key ON issue_comments(issue_key)',
    'CREATE INDEX IF NOT EXISTS idx_changelogs_key ON issue_changelogs(issue_key)',
    'CREATE INDEX IF NOT EXISTS idx_worklogs_key ON issue_worklogs(issue_key)',
    'CREATE INDEX IF NOT EXISTS idx_links_source ON issue_links(source_key)',
    'CREATE INDEX IF NOT EXISTS idx_links_target ON issue_links(target_key)',
    // Git indexes
    'CREATE INDEX IF NOT EXISTS idx_commits_author ON commits(author)',
    'CREATE INDEX IF NOT EXISTS idx_commits_date ON commits(committed_at)',
    'CREATE INDEX IF NOT EXISTS idx_commits_repo ON commits(repo_path)',
    'CREATE INDEX IF NOT EXISTS idx_commits_search ON commits USING GIN(search_vector)',
    'CREATE INDEX IF NOT EXISTS idx_commit_files_hash ON commit_files(commit_hash)',
    'CREATE INDEX IF NOT EXISTS idx_commit_files_path ON commit_files(file_path)',
    'CREATE INDEX IF NOT EXISTS idx_commit_refs_issue ON commit_issue_refs(issue_key)',
  ];

  for (const idx of indexes) {
    await pool.query(idx);
  }
}
