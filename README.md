# Argustack

**RAG engine for project intelligence — ask AI about your Jira, Git, and databases**

[RAG](https://en.wikipedia.org/wiki/Retrieval-augmented_generation) (Retrieval-Augmented Generation) — an architecture where AI answers questions based on **your** data, not its training set:

1. **Retrieval** — pull and index your project data locally (PostgreSQL + pgvector)
2. **Augmentation** — inject relevant context into the AI prompt
3. **Generation** — LLM generates answers grounded in your actual Jira tickets, code, and databases

Argustack builds this knowledge base from your project's sources of truth:

```
┌──────────┐  ┌──────────┐  ┌──────────┐
│   JIRA   │  │   GIT    │  │    DB    │
│ planned  │  │  built   │  │  exists  │
└────┬─────┘  └────┬─────┘  └────┬─────┘
     └─────────────┼─────────────┘
               Retrieval
           ┌───────▼───────┐
           │  PostgreSQL   │
           │  + pgvector   │
           └───────┬───────┘
            Augmentation
           ┌───────▼───────┐
           │  MCP Server   │──── Claude / LLM
           └───────────────┘
             Generation
```

> *Is this bug still relevant or already fixed in code?*
> *Was the feature implemented as described in the ticket?*
> *Who worked on this module and what changed last month?*
> *Show me all unresolved bugs assigned to the backend team.*

## How it works

**Retrieval** — pulls all data from Jira (Git and DB coming soon) into local PostgreSQL with pgvector. Every field, every comment, every changelog entry. Raw JSON preserved as-is.

**Augmentation** — MCP server gives Claude Desktop / Claude Code direct access to your local database. Full-text search, filters, SQL, statistics.

**Generation** — ask questions in natural language. Claude queries your data and answers with context.

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

1. Ask for your Jira credentials and test the connection
2. Create a workspace with Docker config
3. Start PostgreSQL + pgweb automatically
4. Pull all your Jira data

```
? Workspace directory: ~/projects/my-team
? Source: Jira
? Jira URL: https://your-team.atlassian.net
? Email: you@company.com
? API Token: ****

Testing connection... Connected! Found 3 projects: MKT, BRAND, WEB

? Projects to pull [all]: MKT, BRAND
? Start database and sync now? Yes

✔ Database running!
✔ PostgreSQL ready!
✔ Jira sync complete!
  MKT: 1205 issues, 340 comments, 4521 changelogs
  BRAND: 89 issues, 12 comments, 203 changelogs
```

Browse your data at [localhost:8086](http://localhost:8086) (pgweb UI).

### Connect to Claude

```bash
argustack mcp install
```

Adds Argustack as an MCP server to Claude Desktop. Now you can ask Claude questions about your project data directly.

## Commands

```bash
argustack init                       # create workspace (interactive)
argustack sync                       # pull data from all configured sources
argustack sync -p PROJ               # pull specific project
argustack sync --since 2025-01-01    # incremental pull (only new/updated)
argustack sources                    # list configured sources
argustack status                     # workspace info
argustack mcp install                # connect to Claude Desktop
```

## What gets stored

All data goes into local PostgreSQL (nothing leaves your machine):

| Table | Content |
|-------|---------|
| `issues` | All issues — typed columns + `custom_fields` JSONB + full `raw_json` |
| `issue_comments` | Comments with authors and timestamps |
| `issue_changelogs` | Every field change in history |
| `issue_worklogs` | Time tracking entries |
| `issue_links` | Issue-to-issue relationships |

Every custom field is preserved exactly as Jira returns it. 500 custom fields? All 500 stored, no filtering.

## MCP Tools

When connected to Claude, these tools are available:

| Tool | What it does |
|------|-------------|
| `query_issues` | Search issues — full-text, filters, or raw SQL |
| `get_issue` | Full issue details with comments, changelogs, custom fields |
| `issue_stats` | Aggregate stats — by status, type, assignee, project |
| `pull_jira` | Sync latest data from Jira |
| `list_projects` | List available Jira projects |
| `workspace_info` | Current workspace configuration |

## Multiple workspaces

Each data source = separate workspace (like git repos):

```
~/projects/
├── client-alpha/       # argustack init → Alpha's Jira
│   ├── .argustack/
│   ├── .env            # Alpha credentials
│   └── docker-compose.yml
│
├── client-beta/        # argustack init → Beta's Jira
│   ├── .argustack/
│   ├── .env            # Beta credentials
│   └── docker-compose.yml
```

## Security

- **All data stays local** — PostgreSQL runs in Docker on your machine
- **No cloud, no telemetry** — zero network calls except to your Jira instance
- **Credentials in `.env`** — never committed to git (`.gitignore` enforced)
- **Each workspace is isolated** — separate database, separate credentials

## Tech Stack

- TypeScript / Node.js
- Commander.js — CLI
- jira.js — Jira REST API
- PostgreSQL 16 + pgvector — storage + vector search
- MCP SDK — Claude integration
- Docker — database infrastructure

## Roadmap

- [x] Jira pull (all fields, comments, changelogs, worklogs, links)
- [x] MCP server for Claude Desktop / Claude Code
- [ ] Git adapter (commits, diffs, blame)
- [ ] Database adapter (schema, sample data)
- [ ] Embeddings + semantic search
- [ ] Cross-source analysis (Jira ticket vs actual code vs DB state)

## License

MIT
