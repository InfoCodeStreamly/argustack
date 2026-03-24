# Argustack Quick Start Guide

Version 0.1.12 | March 2026

Get from zero to your first AI-powered project query in under 5 minutes.

Visit the project on [GitHub](https://github.com/InfoCodeStreamly/argustack) or install from [npm](https://www.npmjs.com/package/argustack).

> **Note:** This documentation is actively maintained alongside the codebase. While we verify accuracy with each release, minor discrepancies may exist as features evolve. For the latest information, refer to the [GitHub repository](https://github.com/InfoCodeStreamly/argustack). Found an issue? [Open a ticket](https://github.com/InfoCodeStreamly/argustack/issues).

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Install](#2-install)
3. [Initialize a Workspace](#3-initialize-a-workspace)
4. [Sync Your Data](#4-sync-your-data)
5. [Connect Claude](#5-connect-claude)
6. [Your First Queries](#6-your-first-queries)
7. [Next Steps](#7-next-steps)

---

## 1. Prerequisites

Before you start, make sure you have:

| Requirement | Version | Check |
|-------------|---------|-------|
| **Node.js** | 20+ | `node --version` |
| **Docker** | Any recent | `docker --version` |
| **Claude Desktop** or **Claude Code** | Latest | Installed and running |

You'll also need credentials for at least one data source:

| Source | What you need |
|--------|--------------|
| **Jira Cloud** | URL, email, API token |
| **Jira CSV** | Exported CSV file (no credentials needed) |
| **Git** | Path to local repo on disk |
| **GitHub** | Personal access token (fine-grained, read-only) |
| **Database** | Host, port, user, password, database name (read-only access) |

---

## 2. Install

```bash
npm install -g argustack
```

Verify installation:

```bash
argustack --version
```

---

## 3. Initialize a Workspace

Navigate to your project directory and run:

```bash
argustack init
```

The interactive wizard will:

1. **Ask for a workspace name** — creates a named subdirectory (e.g. `my-project/`)
2. **Create workspace files** — `.argustack/`, `.env`, `docker-compose.yml`, `.mcp.json`
3. **Ask which sources to enable** — Jira, Git, GitHub, CSV, Database
4. **Collect credentials** — API tokens, repo paths, project keys (Jira URL and email are masked with asterisks during input)
5. **Auto-configure Claude Code** — writes `.mcp.json` in workspace + parent directory, and updates global `~/.claude/settings.json`
6. **Start PostgreSQL** — Docker container on port 5434

### Non-Interactive Mode

For CI/CD or scripted setups:

```bash
argustack init --no-interactive \
  --jira-url https://your-instance.atlassian.net \
  --jira-email you@company.com \
  --jira-token xxxxxxxxxxx \
  --jira-projects PROJ,TEAM \
  --git-repo /path/to/repo \
  --github-token ghp_xxxx \
  --github-owner your-org \
  --github-repo your-repo
```

### CSV-Only Setup

If you don't have Jira API access, export issues as CSV from Jira and use:

```bash
argustack init
# Select "csv" as source type
# Point to your exported CSV file
```

---

## 4. Sync Your Data

Pull all enabled sources:

```bash
argustack sync
```

Or sync specific sources:

```bash
argustack sync jira           # Jira issues, comments, changelogs
argustack sync git            # Git commits and file changes
argustack sync github         # PRs, reviews, releases
argustack sync csv            # Import from CSV file
argustack sync db             # Pull external database schema
```

### What happens during sync

```
Source API  →  Argustack  →  Local PostgreSQL
(Jira/Git/GitHub)              (Docker, port 5434)
```

- Data streams in batches (100 issues per page)
- Progress bar shows completion: `150/506 issues (30%)`
- Re-running sync is safe — UPSERT, no duplicates
- Incremental by default — only pulls new/updated data

### Incremental Sync

```bash
argustack sync --since 2025-01-01    # Only changes after this date
argustack sync jira -p PROJ          # Specific project
```

---

## 5. Connect Claude

### Claude Code

**No extra steps needed.** `argustack init` automatically writes `.mcp.json` in the workspace and parent directories, and updates global `~/.claude/settings.json`. Just open the workspace folder in Claude Code — MCP tools are ready.

### Claude Desktop

```bash
argustack mcp install
```

This adds the MCP configuration to `claude_desktop_config.json`. Restart Claude Desktop to activate.

### Verify connection

In Claude, ask:

> "Use workspace_info to show my Argustack setup"

You should see your workspace path, configured sources, and database connection.

---

## 6. Your First Queries

Once connected, try these queries with Claude:

### Search issues

> "Search for issues related to payment processing"

Claude uses `query_issues` to full-text search your Jira issues.

### Check a specific ticket

> "Show me full details of PROJ-123"

Claude uses `get_issue` to return description, comments, changelogs, and all custom fields.

### Cross-reference code and tickets

> "What code was written for PROJ-123?"

Claude uses `issue_commits` to find all Git commits mentioning this issue key.

### Full timeline

> "Show me the complete timeline for PROJ-123 — from ticket creation to code merge"

Claude uses `issue_timeline` to combine Jira changelogs, Git commits, and GitHub PRs into one chronological view.

### Project overview

> "Give me a breakdown of all issues by status and assignee"

Claude uses `issue_stats` for aggregate statistics.

### Estimate a task

> "How long will it take John to fix a login timeout bug?"

Claude uses `estimate` to predict duration based on similar completed tasks and John's personal velocity.

---

## 7. Next Steps

### Enable hybrid search

Generate AI embeddings to upgrade hybrid search from text-only to text + semantic:

```bash
argustack embed
```

Requires `OPENAI_API_KEY` in `.env`. After embedding, ask Claude:

> "Find issues similar to 'users can't reset their password'"

### Explore all 20 MCP tools

| Category | Tools |
|----------|-------|
| **Jira** | query_issues, get_issue, issue_stats, pull_jira, list_projects |
| **Git** | query_commits, issue_commits, commit_stats |
| **GitHub** | query_prs, issue_prs, query_releases |
| **Database** | db_schema, db_query, db_stats |
| **Cross-source** | issue_timeline, hybrid_search, estimate |
| **System** | workspace_info, switch_workspace, list_workspaces |

### Browse your data directly

pgweb UI is available at `http://localhost:8086` — browse tables, run SQL queries, explore your data visually.

### Multiple workspaces

Each project gets its own named workspace. Running `argustack init` again in the same directory creates a new workspace as a subdirectory. Use `switch_workspace` and `list_workspaces` MCP tools to navigate between them from within Claude.

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Docker not running | `docker compose up -d` in workspace directory |
| Port conflict on 5434 | Edit `DB_PORT` in `.env` and `docker-compose.yml` |
| Module not found | Check Node.js 20+ and reinstall: `npm i -g argustack` |
| MCP not connecting | Run `argustack mcp install` and restart Claude |
| Sync shows 0 issues | Verify credentials in `.env`, check project keys |

---

Visit the project on [GitHub](https://github.com/InfoCodeStreamly/argustack) or install from [npm](https://www.npmjs.com/package/argustack).
