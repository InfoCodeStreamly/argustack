# Argustack

**RAG engine for project intelligence — ask AI about your Jira, Git, and databases**

[RAG](https://en.wikipedia.org/wiki/Retrieval-augmented_generation) (Retrieval-Augmented Generation) — an architecture where AI answers questions based on **your** data, not its training set:

1. **Retrieval** — pull and index your project data locally (PostgreSQL + pgvector)
2. **Augmentation** — inject relevant context into the AI prompt
3. **Generation** — LLM generates answers grounded in your actual Jira tickets, code, and databases

Argustack builds this knowledge base from your project's sources of truth:

```
     YOUR SOURCES                                YOUR MACHINE
  ┌──────────────────────┐        ┌─────────────────────────────────────┐
  │  Jira Cloud / Server │        │                                     │
  │  (issues, comments,  │  pull  │  PostgreSQL (Docker, localhost)     │
  │   changelogs, etc.)  │ ──────►│  ├── issues          (all fields)  │
  └──────────────────────┘        │  ├── issue_comments  (discussions) │
                                  │  ├── issue_changelogs (history)    │
  ┌──────────────────────┐        │  ├── issue_worklogs  (time logs)  │
  │  Git repository      │  pull  │  ├── issue_links     (relations)  │
  │  (commits, files,    │ ──────►│  ├── commits         (history)    │
  │   diffs, authors)    │        │  ├── commit_files    (per-file +/-│)│
  └──────────────────────┘        │  └── commit_issue_refs (cross-ref)│
                                  │                                     │
  ┌──────────────────────┐        │  MCP Server (localhost, stdio)      │
  │  Database (planned)  │        │  └── queries DB ──► Claude / LLM   │
  └──────────────────────┘        │                                     │
                                  │  .env (credentials — never leaves) │
                                  └─────────────────────────────────────┘
```

> *Is this bug still relevant or already fixed in code?*
> *Was the feature implemented as described in the ticket?*
> *Who worked on this module and what changed last month?*
> *Which commits reference ticket PAP-123?*

## How it works

**Retrieval** — pulls all data from Jira and Git into local PostgreSQL with pgvector. Every field, every comment, every changelog entry, every commit with per-file additions/deletions. Raw JSON preserved as-is. Nothing is filtered or lost.

**Augmentation** — MCP server gives Claude Desktop / Claude Code direct access to your local database. Full-text search, filters, raw SQL, aggregate statistics, cross-reference between Jira issues and Git commits — all without leaving your machine.

**Generation** — ask questions in natural language. Claude queries your local data and answers with full project context.

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) >= 20
- [Docker](https://www.docker.com/) (or [OrbStack](https://orbstack.dev/) / Podman)

### Install & setup

```bash
npm i -g argustack
argustack init
```

That's it. The interactive setup will:

1. Ask which sources you have (Jira, Git, Database)
2. Collect credentials and test connections
3. For Git — choose local path or clone from URL
4. Create a workspace with Docker config
5. Start PostgreSQL + pgweb automatically
6. Pull all your data

```
? Workspace directory: ~/projects/my-team
? Sources: Jira, Git
? Jira URL: https://your-team.atlassian.net
? Email: you@company.com
? API Token: ****

Testing connection... Connected! Found 3 projects: MKT, BRAND, WEB

? Projects to pull [all]: MKT, BRAND
? Where is your Git repository?
  ● Local path — already cloned on this machine
? Path to local repo: ~/projects/my-team-repo

? Start database and sync now? Yes

✔ Database running!
✔ PostgreSQL ready!
✔ Jira sync complete!
  MKT: 1205 issues, 340 comments, 4521 changelogs
  BRAND: 89 issues, 12 comments, 203 changelogs
✔ Git sync complete!
  142 commits, 876 files, 23 issue refs
```

Browse your data at [localhost:8086](http://localhost:8086) — pgweb UI for running SQL queries and exploring tables in your browser.

### Connect to Claude

```bash
argustack mcp install
```

Adds Argustack as an MCP server to Claude Desktop. Now you can ask Claude questions about your project data directly.

## Commands

```bash
argustack init                       # create workspace (interactive)
argustack sync                       # pull data from all configured sources
argustack sync jira                  # pull Jira only
argustack sync git                   # pull Git only
argustack sync -p PROJ               # pull specific project
argustack sync --since 2025-01-01    # incremental pull (only new/updated)
argustack sources                    # list configured sources
argustack status                     # workspace info
argustack mcp install                # connect to Claude Desktop
```

## What gets stored

All data goes into local PostgreSQL in Docker on your machine (nothing leaves `localhost`):

### Jira tables

| Table | Content |
|-------|---------|
| `issues` | All issues — typed columns + `custom_fields` JSONB + full `raw_json` |
| `issue_comments` | Comments with authors and timestamps |
| `issue_changelogs` | Every field change in history |
| `issue_worklogs` | Time tracking entries |
| `issue_links` | Issue-to-issue relationships |

Every custom field is preserved exactly as Jira returns it. 500 custom fields? All stored. Zero filtering, zero data loss.

### Git tables

| Table | Content |
|-------|---------|
| `commits` | Commit hash, message, author, email, date, full-text search |
| `commit_files` | Per-file changes — path, status, additions, deletions |
| `commit_issue_refs` | Cross-reference: commit ↔ Jira issue (extracted from commit messages) |

Commit messages mentioning issue keys like `PAP-123` or `PROJ-45` are automatically linked to Jira issues.

## MCP Tools

When connected to Claude, these tools are available:

### Jira tools

| Tool | What it does |
|------|-------------|
| `query_issues` | Search issues — full-text, filters, or raw SQL |
| `get_issue` | Full issue details with comments, changelogs, custom fields |
| `issue_stats` | Aggregate stats — by status, type, assignee, project |
| `pull_jira` | Sync latest data from Jira |
| `list_projects` | List available Jira projects |

### Git tools

| Tool | What it does |
|------|-------------|
| `query_commits` | Search commits by text, author, date, file path, or raw SQL |
| `issue_commits` | Cross-reference: find all commits mentioning a Jira issue key |
| `commit_stats` | Aggregate stats — top authors, most changed files, linked issues |

### System tools

| Tool | What it does |
|------|-------------|
| `workspace_info` | Current workspace configuration |

## Multiple workspaces

Each data source = separate workspace (like git repos):

```
~/projects/
├── client-alpha/       # argustack init → Alpha's Jira + Git
│   ├── .argustack/
│   ├── .env            # Alpha credentials
│   └── docker-compose.yml
│
├── client-beta/        # argustack init → Beta's Jira + Git
│   ├── .argustack/
│   ├── .env            # Beta credentials
│   └── docker-compose.yml
```

## Security & Credentials

**Argustack is a CLI tool. It has no backend, no cloud, no accounts.** Everything runs on your machine.

When you run `argustack init`, it creates a `.env` file in your workspace with your credentials:

```bash
# .env — YOUR file, on YOUR machine, never uploaded anywhere
JIRA_URL=https://your-team.atlassian.net
JIRA_EMAIL=you@company.com
JIRA_API_TOKEN=ATATT3x...
JIRA_PROJECTS=PROJ,OTHER
GIT_REPO_PATH=/path/to/your/repo
DB_HOST=localhost
DB_PORT=5434
DB_USER=argustack
DB_PASSWORD=argustack_local
DB_NAME=argustack
```

**Where credentials go:**

| What | Where | Who can see |
|------|-------|-------------|
| Jira token | `.env` on your disk | Only you |
| Jira data | PostgreSQL in Docker on `localhost:5434` | Only you |
| Git data | PostgreSQL in Docker on `localhost:5434` | Only you |
| Database password | `.env` on your disk (default: `argustack_local`) | Only you |
| Source code (this repo) | GitHub | Everyone — **no secrets here** |

**What Argustack does NOT do:**
- Does not send your data to any external server
- Does not have analytics, telemetry, or tracking
- Does not store credentials anywhere except your local `.env`
- Does not require registration or accounts

**`.env` is in `.gitignore`** — if you accidentally run `git add .`, your credentials won't be committed.

## Tech Stack

- TypeScript / Node.js
- Commander.js — CLI
- jira.js — Jira REST API
- es-git — native Git bindings (N-API, powered by libgit2)
- PostgreSQL 16 + pgvector — storage + vector search
- MCP SDK — Claude integration
- Docker — database infrastructure

## Roadmap

- [x] Jira pull (all fields, comments, changelogs, worklogs, links)
- [x] Git pull (commits, per-file diffs, issue cross-references)
- [x] MCP server for Claude Desktop / Claude Code (9 tools)
- [ ] Database adapter (schema, sample data)
- [ ] Embeddings + semantic search
- [ ] Cross-source analysis (Jira ticket vs actual code vs DB state)
- [ ] CSV import (Jira export without API token)

## License

MIT
