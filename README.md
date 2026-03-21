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
  │   diffs, authors)    │        │  ├── commit_files    (per-file Δ) │
  └──────────────────────┘        │  ├── commit_issue_refs (cross-ref)│
                                  │  │                                  │
  ┌──────────────────────┐        │  │  GitHub (optional, via token)    │
  │  GitHub API          │  pull  │  ├── pull_requests   (PRs + meta) │
  │  (PRs, reviews,      │ ──────►│  ├── pr_reviews      (approvals)  │
  │   releases)          │        │  ├── pr_comments     (discussions) │
  └──────────────────────┘        │  ├── pr_issue_refs   (PR↔Jira)    │
                                  │  └── releases        (tags)        │
  ┌──────────────────────┐        │                                     │
  │  Database (planned)  │        │  MCP Server (localhost, stdio)      │
  └──────────────────────┘        │  └── queries DB ──► Claude / LLM   │
                                  │                                     │
                                  │  .env (credentials — never leaves) │
                                  └─────────────────────────────────────┘
```

> *Is this bug still relevant or already fixed in code?*
> *Was the feature implemented as described in the ticket?*
> *Who worked on this module and what changed last month?*
> *Which commits and PRs reference ticket PAP-123?*
> *Who approved the PR and what was the review feedback?*

## How it works

**Retrieval** — pulls all data from Jira, Git, and GitHub into local PostgreSQL with pgvector. Every field, every comment, every changelog entry, every commit with per-file diffs, every PR with reviews and approvals. Raw JSON preserved as-is. Nothing is filtered or lost.

**Augmentation** — MCP server gives Claude Desktop / Claude Code direct access to your local database. Full-text search, semantic search (pgvector embeddings), filters, raw SQL, aggregate statistics, cross-source timeline, cross-reference between Jira issues, Git commits, and GitHub PRs — all without leaving your machine.

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

Argustack supports **two modes** of initialization:

#### Interactive mode (default)

Run `argustack init` and follow the prompts:

```
? Workspace directory: ~/projects/my-team
? Sources: ✔ Jira — issues, comments, changelogs
           ✔ Git — commits, diffs, authors
           ✔ GitHub — PRs, reviews, releases
? Jira URL: https://your-team.atlassian.net
? Email: you@company.com
? API Token: ****

Testing connection... Connected! Found 3 projects: MKT, BRAND, WEB

? Projects to pull: ✔ MKT  ✔ BRAND
? Where is your Git repository?
  ● Clone from GitHub — select repos using your token
? GitHub token (PAT): ****

Fetching repositories... Found 12 repos.

? Repositories to clone: ✔ your-org/frontend  ✔ your-org/backend
? GitHub source: Auto-configured from clone step

? Start database and sync now? Yes

✔ Database running!
✔ Jira sync complete!
  MKT: 506 issues (150/506 ████░░░░ 30% → 506/506 done)
✔ Git sync complete!
  your-org/frontend: 735 commits (400/735 ██████░░ 54% → 735/735 done)
✔ GitHub sync complete!
  66 PRs (30/66 ██████░░ 45% → 66/66 done), 124 reviews, 3 releases
```

The interactive setup will:

1. Ask which sources you have (Jira, Git, GitHub, Database)
2. Collect credentials and test connections
3. For Git — choose local path, clone from GitHub (multi-select repos), or clone from URL
4. For GitHub — auto-configured if you cloned from GitHub in the previous step, or enter a Personal Access Token (see [GitHub token setup](#github-token-setup))
5. Create a workspace with Docker config
6. Start PostgreSQL + pgweb automatically
7. Pull all your data

#### Non-interactive mode (for AI agents and CI/CD)

Pass `--no-interactive` with all values as CLI flags — no prompts, no terminal needed:

```bash
argustack init \
  --no-interactive \
  --dir ~/projects/my-team \
  --source jira,git,github \
  --jira-url "https://your-team.atlassian.net" \
  --jira-email "you@company.com" \
  --jira-token "ATATT3x..." \
  --jira-projects PAP,MKT \
  --git-repo /path/to/repo1,/path/to/repo2 \
  --github-token "github_pat_..." \
  --github-owner your-org \
  --github-repo your-repo
```

Then start the database and sync:

```bash
cd ~/projects/my-team
docker compose up -d
argustack sync
```

All available flags:

| Flag | Description |
|------|-------------|
| `--no-interactive` | Run without prompts — all values from flags |
| `-d, --dir <path>` | Workspace directory (default: current) |
| `-s, --source <list>` | Comma-separated: `jira,git,github,db` |
| `--jira-url <url>` | Jira instance URL |
| `--jira-email <email>` | Jira user email |
| `--jira-token <token>` | Jira API token |
| `--jira-projects <keys>` | Comma-separated project keys, or `all` |
| `--git-repo <paths>` | Git repo paths, comma-separated |
| `--github-token <token>` | GitHub Personal Access Token |
| `--github-owner <owner>` | GitHub repo owner |
| `--github-repo <repo>` | GitHub repo name |
| `--db-port <port>` | Argustack PostgreSQL port (default: `5434`) |
| `--pgweb-port <port>` | pgweb UI port (default: `8086`) |

This mode is ideal for:
- **AI agents** — a project manager tells their AI agent "set up argustack" and it runs everything autonomously
- **CI/CD pipelines** — automated workspace provisioning
- **Scripted setups** — reproducible environment creation

Browse your data at [localhost:8086](http://localhost:8086) — pgweb UI for running SQL queries and exploring tables in your browser.

### Connect to Claude

```bash
argustack mcp install
```

Adds Argustack as an MCP server to Claude Desktop. Now you can ask Claude questions about your project data directly.

## Commands

```bash
argustack init                       # create workspace (interactive prompts)
argustack init --no-interactive ...  # create workspace from CLI flags (no prompts)
argustack sync                       # pull data from all configured sources
argustack sync jira                  # pull Jira only
argustack sync git                   # pull Git commits only
argustack sync github                # pull GitHub PRs, reviews, releases
argustack sync -p PROJ               # pull specific Jira project
argustack sync --since 2025-01-01    # incremental pull (only new/updated)
argustack sources                    # list configured sources
argustack status                     # workspace info
argustack embed                      # generate embeddings for semantic search
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

### GitHub tables

Select "GitHub" during `argustack init` or add later with `argustack source add github`:

| Table | Content |
|-------|---------|
| `pull_requests` | PRs — state, author, reviewers, additions/deletions, merge info, full-text search |
| `pr_reviews` | Review approvals and change requests |
| `pr_comments` | Inline review comments with file paths and line numbers |
| `pr_files` | Per-file changes in each PR |
| `pr_issue_refs` | Cross-reference: PR ↔ Jira issue (extracted from PR title and body) |
| `releases` | GitHub releases with tags, notes, and full-text search |

PR titles and bodies mentioning issue keys like `PAP-123` are automatically linked to Jira issues — just like commits.

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
| `query_commits` | Search commits by text, author, date, file path, or raw SQL. Optional `repo_path` filter for multi-repo workspaces |
| `issue_commits` | Cross-reference: find all commits mentioning a Jira issue key. Optional `repo_path` filter |
| `commit_stats` | Aggregate stats — top authors, most changed files, linked issues. Optional `repo_path` filter |

### GitHub tools

| Tool | What it does |
|------|-------------|
| `query_prs` | Search PRs — full-text, state, author, base branch, or raw SQL |
| `issue_prs` | Cross-reference: find all PRs mentioning a Jira issue key with reviews |
| `query_releases` | List releases with full-text search |

### Cross-source tools

| Tool | What it does |
|------|-------------|
| `issue_timeline` | Chronological timeline — changelogs + commits + PRs for one issue |
| `semantic_search` | Find similar issues by meaning (pgvector embeddings) |
| `estimate` | Predict effort for new tasks — finds similar completed tasks, analyzes developer profiles, cycle/coding time, bug rate |

### System tools

| Tool | What it does |
|------|-------------|
| `workspace_info` | Current workspace configuration |

## Embeddings & Semantic Search

**Embeddings** turn issue text into numerical vectors that capture meaning. Two issues about "login not working" and "SSO authentication fails" will have similar vectors — even though they share zero keywords.

How it works:

1. `argustack embed` sends each issue's `summary + description` to OpenAI API (`text-embedding-3-small` model)
2. Returns a 1536-dimensional vector per issue, stored in PostgreSQL via pgvector
3. `semantic_search` MCP tool embeds your question, then finds issues with the closest vectors using cosine similarity

```bash
# Generate embeddings for all issues (requires OPENAI_API_KEY in .env)
argustack embed
```

After embedding, ask Claude: *"Find issues similar to payment timeout errors"* — it will search by meaning, not keywords.

**Costs:** text-embedding-3-small costs ~$0.02 per 1M tokens. 10,000 issues ≈ $0.05-0.10.

**Optional:** Embeddings require an OpenAI API key. All other features work without it.

## GitHub token setup

Argustack only reads data from GitHub — it never writes anything. You need a **fine-grained Personal Access Token** with read-only permissions.

1. Go to [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new)
2. **Token name** — anything (e.g. `argustack`)
3. **Description** — optional, can leave empty
4. **Resource owner** — your account, or the organization that owns the repo
5. **Expiration** — "No expiration" recommended. Token is read-only and stays in your local `.env`
6. **Repository access** — pick one:
   - **Only select repositories** (recommended) — pick specific repos, max 50
   - **All repositories** — all your current and future repos
   - **Public repositories** — read-only access to public repos only
5. **Permissions** → Repository permissions (3 total):

| Permission | Access | Why |
|---|---|---|
| **Contents** | Read-only | Releases, downloads, tags |
| **Metadata** | Read-only | Repository info (auto-selected, required) |
| **Pull requests** | Read-only | PRs, reviews, comments, files |

7. Click "Generate token" and copy it

During `argustack init`, select "GitHub" as a source and paste the token when asked. Or add to `.env` manually:

```bash
GITHUB_TOKEN=github_pat_...
GITHUB_OWNER=your-org
GITHUB_REPO=your-repo
```

Then run `argustack source add github` and `argustack sync github`.

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

# === Jira ===
JIRA_URL=https://your-team.atlassian.net
JIRA_EMAIL=you@company.com
JIRA_API_TOKEN=your-api-token-here
JIRA_PROJECTS=PROJ,OTHER

# === Git ===
GIT_REPO_PATHS=/path/to/repo1,/path/to/repo2

# === GitHub ===
GITHUB_TOKEN=github_pat_...
GITHUB_OWNER=your-org
GITHUB_REPO=your-repo

# === Argustack internal PostgreSQL (match docker-compose.yml) ===
DB_HOST=localhost
DB_PORT=5434
DB_USER=argustack
DB_PASSWORD=argustack_local
DB_NAME=argustack

# === OpenAI embeddings (optional, for semantic search) ===
# OPENAI_API_KEY=sk-...
```

**Where credentials go:**

| What | Where | Who can see |
|------|-------|-------------|
| Jira token | `.env` on your disk | Only you |
| GitHub token | `.env` on your disk | Only you |
| Jira data | PostgreSQL in Docker on `localhost:5434` | Only you |
| Git + GitHub data | PostgreSQL in Docker on `localhost:5434` | Only you |
| Database password | `.env` on your disk | Only you |
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
- Octokit — GitHub REST API (PRs, reviews, releases)
- es-git — native Git bindings (N-API, powered by libgit2)
- PostgreSQL 16 + pgvector — storage + vector search
- MCP SDK — Claude integration
- Docker — database infrastructure

## Roadmap

- [x] Jira pull (all fields, comments, changelogs, worklogs, links)
- [x] Git pull (commits, per-file diffs, issue cross-references)
- [x] GitHub pull (PRs, reviews, comments, files, releases, Jira cross-references)
- [x] MCP server for Claude Desktop / Claude Code (15 tools)
- [x] Embeddings + semantic search (OpenAI text-embedding-3-small, pgvector)
- [x] Cross-source timeline (issue_timeline: changelogs + commits + PRs)
- [x] Multi-repo Git support (multiple repos per workspace, `GIT_REPO_PATHS`)
- [x] Progress indicators during sync (e.g. `150/506 issues (30%)`)
- [ ] Database adapter (schema, sample data)
- [ ] Cross-source analysis (Jira ticket vs actual code vs DB state)
- [ ] CSV import (Jira export without API token)

## License

MIT
