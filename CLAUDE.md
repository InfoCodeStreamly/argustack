# Argustack — CLAUDE.md

## What is this

Argustack — standalone open-source CLI tool for project analysis. Cross-references three sources of truth:
- **Jira** — what was planned (issues, bugs, tasks)
- **Git** — what was actually implemented (code, commits)
- **DB** — what factually exists in the data

Currently building **Component 1: Jira Pull** — downloads everything from any Jira instance into local PostgreSQL.

## Tech Stack

- **TypeScript / Node.js** — CLI + core logic
- **Commander.js** — CLI framework with subcommands
- **jira.js** (`Version3Client`) — typed Jira REST API client
- **@inquirer/prompts** — interactive CLI prompts (init)
- **PostgreSQL 16 + pgvector** — local DB (Docker), vector search
- **dotenv** — configuration via `.env`
- **ora / chalk** — CLI UX (spinners, colors)

## Architecture — Clean Architecture (adapted for CLI)

Dependency Rule: `cli/ → use-cases/ → core/ports` ← `adapters/`

```
src/
├── core/                          ← CORE: types + interfaces (zero dependencies)
│   ├── types/
│   │   ├── issue.ts                  Issue, Comment, Changelog, Worklog, Link, IssueBatch
│   │   ├── project.ts                Project
│   │   ├── config.ts                 WorkspaceConfig, SourceConfig
│   │   └── index.ts                  re-exports
│   └── ports/
│       ├── source-provider.ts        ISourceProvider — where data comes from
│       ├── storage.ts                IStorage — where data is stored
│       └── index.ts                  re-exports
│
├── use-cases/                     ← LOGIC: orchestration (depends only on core/)
│   └── pull.ts                       PullUseCase: source.pullIssues() → storage.saveBatch()
│
├── adapters/                      ← IMPLEMENTATIONS: implements core/ports
│   ├── jira/                         JiraProvider implements ISourceProvider
│   │   ├── client.ts                    Version3Client wrapper
│   │   ├── mapper.ts                    Raw Jira JSON → core types
│   │   ├── provider.ts                  Paginated pull, fields=*all, expand=changelog
│   │   └── index.ts                     re-exports
│   └── postgres/                     PostgresStorage implements IStorage
│       ├── connection.ts                pg Pool
│       ├── schema.ts                    CREATE TABLE + indexes (idempotent)
│       ├── storage.ts                   UPSERT logic, transactions
│       └── index.ts                     re-exports
│
├── workspace/                     ← INFRA: workspace management
│   ├── config.ts                     loadConfig(), parseConfig()
│   └── resolver.ts                   find .argustack/ walking up from cwd
│
├── mcp/                           ← MCP SERVER: Claude Desktop integration
│   └── server.ts                     McpServer with tools (query, pull, stats)
│
└── cli/                           ← ENTRY POINT: commands, UX, wiring
    ├── index.ts                      Commander.js setup, registers all commands
    ├── init.ts                       argustack init (interactive workspace setup)
    ├── sync.ts                       argustack sync (wires adapters → use case)
    ├── sources.ts                    argustack sources (list configured sources)
    ├── status.ts                     argustack status (workspace status)
    └── mcp-install.ts                argustack mcp install (Claude Desktop config)
```

### Key Architecture Decisions

- **core/** has ZERO dependencies on external packages — only pure TypeScript types and interfaces
- **use-cases/** depends only on core/ interfaces — doesn't know about Jira, PostgreSQL, or CLI
- **adapters/** implement core/ interfaces — each adapter is replaceable independently
- **cli/** is the composition root — creates adapters, injects them into use cases
- **AsyncGenerator** for `pullIssues()` — memory-efficient streaming of large datasets (100k+ issues)

### Data Flow

```
CLI (sync.ts)
  → creates JiraProvider (adapter)
  → creates PostgresStorage (adapter)
  → creates PullUseCase(source, storage)
  → PullUseCase.execute()
       → source.pullIssues()     ← AsyncGenerator yields IssueBatch pages
       → storage.saveBatch()     ← UPSERT into PostgreSQL
```

## Workspace Concept

Argustack uses a workspace pattern like git. Each workspace is a directory with `.argustack/` marker.

- `argustack init` creates a workspace: `.argustack/`, `.env`, `docker-compose.yml`, `db/init.sql`
- CLI finds workspace by walking up from cwd looking for `.argustack/`
- Each workspace has its own PostgreSQL instance (Docker) and its own Jira credentials

## Key Principles

- **Download ALL fields** — `fields=*all`, every single field Jira returns, even if there are thousands of custom fields
- **Store as-is** — field names preserved exactly as Jira returns them, no renaming, no mapping
- **raw_json JSONB** — full original API response stored in `raw_json` column, nothing filtered or lost
- **Zero configuration** — install, init, pull. No field mapping, no schema customization
- **Universal** — works with any Jira instance, any custom field setup

## Database

- **PostgreSQL 16 + pgvector** running in Docker
- Default port: `5434` (not 5432, to avoid conflicts)
- pgweb UI on port `8086` for browsing tables and running SQL
- Schema managed by `adapters/postgres/schema.ts` (idempotent, CREATE IF NOT EXISTS)
- Template in `templates/init.sql` for initial workspace setup

### Tables
| Table | Purpose |
|-------|---------|
| `issues` | Main table — standard fields + `custom_fields` JSONB + `raw_json` JSONB + `embedding` vector |
| `issue_comments` | Comments per issue |
| `issue_changelogs` | Field change history |
| `issue_worklogs` | Time tracking entries |
| `issue_links` | Issue-to-issue links |

## Configuration

`.env` file in workspace root (created by `argustack init`):
```bash
JIRA_URL=https://instance.atlassian.net
JIRA_EMAIL=user@email.com
JIRA_API_TOKEN=token
JIRA_PROJECTS=PROJ,OTHER
DB_HOST=localhost
DB_PORT=5434
DB_USER=argustack
DB_PASSWORD=argustack_local
DB_NAME=argustack
```

DB credentials are defaults matching `docker-compose.yml` — no need to change.

## Development

```bash
npm install                      # install dependencies
npm run dev -- jira pull         # run via tsx (dev mode)
npm run build                    # compile TypeScript
npm start -- jira pull           # run compiled version
```

## Commands

```bash
argustack init                   # create workspace (interactive)
argustack sync                   # pull all issues from configured sources
argustack sync -p PROJ           # pull specific project
argustack sync --since 2025-01-01  # incremental pull
argustack sources                # list configured sources
argustack status                 # workspace status
argustack mcp install            # install MCP server into Claude Desktop
```

## Code Conventions

- ESM modules (`"type": "module"` in package.json)
- TypeScript strict mode
- File extensions in imports: `import { foo } from './bar.js'`
- Async/await throughout
- No hardcoded field names or project-specific logic
- Dependency Inversion: depend on interfaces (core/ports), not implementations
