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
- **PostgreSQL 16 + pgvector** — local DB (Docker), vector search
- **dotenv** — configuration via `.env`
- **ora / chalk** — CLI UX (spinners, colors)

## Project Structure

```
argustack/
├── src/
│   ├── cli/
│   │   ├── index.ts             # CLI entry point (commander.js)
│   │   ├── init.ts              # argustack init (creates workspace)
│   │   └── jira.ts              # argustack jira pull
│   ├── jira/
│   │   ├── client.ts            # jira.js Version3Client wrapper
│   │   └── pull.ts              # paginated pull → raw JSON
│   ├── db/
│   │   ├── connection.ts        # pg client
│   │   ├── schema.ts            # CREATE TABLE + migrations
│   │   └── import.ts            # JSON → PostgreSQL bulk insert
│   ├── workspace/
│   │   └── resolver.ts          # find .argustack/ up from cwd
│   ├── git/                     # (component 2 — future)
│   └── analyze/                 # (component 3 — future)
├── templates/
│   ├── init.sql                 # PostgreSQL schema template
│   ├── docker-compose.yml       # Docker template
│   └── env.example              # .env template
├── package.json
├── tsconfig.json
└── IDEAS.md                     # full planning document (Ukrainian)
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
- Schema in `templates/init.sql`

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
argustack init                   # create workspace
argustack jira pull              # pull all issues from Jira
argustack jira pull -p PROJ      # pull specific project
argustack status                 # workspace status
```

## Code Conventions

- ESM modules (`"type": "module"` in package.json)
- TypeScript strict mode
- File extensions in imports: `import { foo } from './bar.js'`
- Async/await throughout
- No hardcoded field names or project-specific logic
