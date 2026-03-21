-- Argustack — PostgreSQL schema
-- All Jira data stored as-is, no field renaming or mapping

CREATE EXTENSION IF NOT EXISTS vector;

-- Main issues table
CREATE TABLE issues (
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
    custom_fields JSONB,          -- all custom fields as JSON
    raw_json JSONB,               -- full raw API response, as-is
    embedding vector(1536),       -- pgvector for semantic search
    search_vector tsvector,       -- full-text search
    pulled_at TIMESTAMP DEFAULT NOW()
);

-- Comments
CREATE TABLE issue_comments (
    id SERIAL PRIMARY KEY,
    issue_key VARCHAR(20) NOT NULL REFERENCES issues(issue_key),
    comment_id VARCHAR(20),
    author VARCHAR(100),
    body TEXT,
    created TIMESTAMP,
    updated TIMESTAMP
);

-- Changelog (change history)
CREATE TABLE issue_changelogs (
    id SERIAL PRIMARY KEY,
    issue_key VARCHAR(20) NOT NULL REFERENCES issues(issue_key),
    author VARCHAR(100),
    field VARCHAR(100),
    from_value TEXT,
    to_value TEXT,
    changed_at TIMESTAMP
);

-- Worklogs
CREATE TABLE issue_worklogs (
    id SERIAL PRIMARY KEY,
    issue_key VARCHAR(20) NOT NULL REFERENCES issues(issue_key),
    author VARCHAR(100),
    time_spent VARCHAR(20),
    time_spent_seconds INTEGER,
    comment TEXT,
    started TIMESTAMP
);

-- Links
CREATE TABLE issue_links (
    id SERIAL PRIMARY KEY,
    source_key VARCHAR(20) NOT NULL,
    target_key VARCHAR(20) NOT NULL,
    link_type VARCHAR(50),
    direction VARCHAR(10)
);

-- ─── Git tables ──────────────────────────────────────────────────────

CREATE TABLE commits (
    hash VARCHAR(40) PRIMARY KEY,
    message TEXT,
    author VARCHAR(200),
    email VARCHAR(200),
    committed_at TIMESTAMPTZ,
    parents TEXT[],
    repo_path TEXT,
    search_vector tsvector,
    pulled_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE commit_files (
    id SERIAL PRIMARY KEY,
    commit_hash VARCHAR(40) NOT NULL REFERENCES commits(hash),
    file_path TEXT NOT NULL,
    status VARCHAR(20),
    additions INTEGER DEFAULT 0,
    deletions INTEGER DEFAULT 0
);

CREATE TABLE commit_issue_refs (
    commit_hash VARCHAR(40) NOT NULL REFERENCES commits(hash),
    issue_key VARCHAR(20) NOT NULL,
    PRIMARY KEY (commit_hash, issue_key)
);

-- ─── GitHub tables ──────────────────────────────────────────────────

CREATE TABLE pull_requests (
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
);

CREATE TABLE pr_reviews (
    id SERIAL PRIMARY KEY,
    pr_number INTEGER NOT NULL,
    repo_full_name VARCHAR(200) NOT NULL,
    review_id INTEGER NOT NULL,
    reviewer VARCHAR(200),
    state VARCHAR(30),
    body TEXT,
    submitted_at TIMESTAMPTZ
);

CREATE TABLE pr_comments (
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
);

CREATE TABLE pr_files (
    id SERIAL PRIMARY KEY,
    pr_number INTEGER NOT NULL,
    repo_full_name VARCHAR(200) NOT NULL,
    file_path TEXT NOT NULL,
    status VARCHAR(20),
    additions INTEGER DEFAULT 0,
    deletions INTEGER DEFAULT 0
);

CREATE TABLE pr_issue_refs (
    pr_number INTEGER NOT NULL,
    repo_full_name VARCHAR(200) NOT NULL,
    issue_key VARCHAR(20) NOT NULL,
    PRIMARY KEY (repo_full_name, pr_number, issue_key)
);

CREATE TABLE releases (
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
);

-- ─── Indexes ────────────────────────────────────────────────────────

-- Jira indexes
CREATE INDEX idx_issues_project ON issues(project_key);
CREATE INDEX idx_issues_status ON issues(status);
CREATE INDEX idx_issues_type ON issues(issue_type);
CREATE INDEX idx_issues_assignee ON issues(assignee);
CREATE INDEX idx_issues_created ON issues(created);
CREATE INDEX idx_issues_updated ON issues(updated);
CREATE INDEX idx_issues_search ON issues USING GIN(search_vector);
CREATE INDEX idx_issues_custom ON issues USING GIN(custom_fields);
CREATE INDEX idx_issues_raw ON issues USING GIN(raw_json);
CREATE INDEX idx_comments_key ON issue_comments(issue_key);
CREATE INDEX idx_changelogs_key ON issue_changelogs(issue_key);
CREATE INDEX idx_worklogs_key ON issue_worklogs(issue_key);
CREATE INDEX idx_links_source ON issue_links(source_key);
CREATE INDEX idx_links_target ON issue_links(target_key);

-- Git indexes
CREATE INDEX idx_commits_author ON commits(author);
CREATE INDEX idx_commits_date ON commits(committed_at);
CREATE INDEX idx_commits_repo ON commits(repo_path);
CREATE INDEX idx_commits_search ON commits USING GIN(search_vector);
CREATE INDEX idx_commit_files_hash ON commit_files(commit_hash);
CREATE INDEX idx_commit_files_path ON commit_files(file_path);
CREATE INDEX idx_commit_refs_issue ON commit_issue_refs(issue_key);

-- GitHub indexes
CREATE INDEX idx_prs_repo ON pull_requests(repo_full_name);
CREATE INDEX idx_prs_state ON pull_requests(state);
CREATE INDEX idx_prs_author ON pull_requests(author);
CREATE INDEX idx_prs_merged ON pull_requests(merged_at);
CREATE INDEX idx_prs_updated ON pull_requests(updated_at);
CREATE INDEX idx_prs_merge_sha ON pull_requests(merge_commit_sha);
CREATE INDEX idx_prs_search ON pull_requests USING GIN(search_vector);
CREATE INDEX idx_pr_reviews_pr ON pr_reviews(repo_full_name, pr_number);
CREATE INDEX idx_pr_comments_pr ON pr_comments(repo_full_name, pr_number);
CREATE INDEX idx_pr_files_pr ON pr_files(repo_full_name, pr_number);
CREATE INDEX idx_pr_files_path ON pr_files(file_path);
CREATE INDEX idx_pr_refs_issue ON pr_issue_refs(issue_key);
CREATE INDEX idx_releases_repo ON releases(repo_full_name);
CREATE INDEX idx_releases_tag ON releases(tag_name);
CREATE INDEX idx_releases_search ON releases USING GIN(search_vector);
