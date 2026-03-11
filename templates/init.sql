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

-- Indexes
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
