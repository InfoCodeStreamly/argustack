# Argustack — CLAUDE.md

## What is this

Argustack — standalone open-source CLI tool for project analysis. Cross-references sources of truth:
- **Jira** — what was planned (issues, bugs, tasks)
- **Jira CSV** — import from CSV export for teams without API access
- **Git** — what was coded (commits, diffs, authors)
- **GitHub** — what was reviewed (PRs, approvals, releases)
- **DB** — what factually exists in production (schema introspection + read-only queries)
- **Jira Proxy** — connect through company proxy/gateway for restricted Jira instances

Downloads everything into local PostgreSQL, then gives Claude direct access via MCP server (23 tools).

## Tech Stack

- **TypeScript / Node.js** — CLI + core logic
- **Commander.js** — CLI framework with subcommands
- **jira.js** (`Version3Client`) — typed Jira REST API client
- **Octokit** — GitHub REST API (PRs, reviews, releases)
- **es-git** — native Git bindings (N-API, libgit2)
- **csv-parse** — streaming RFC 4180 CSV parser (for Jira CSV import)
- **@inquirer/prompts** — interactive CLI prompts (init)
- **PostgreSQL 16 + pgvector** — local DB (Docker), vector search
- **OpenAI** — text-embedding-3-small for semantic search (optional)
- **MCP SDK** — Claude Desktop / Claude Code integration
- **dotenv** — configuration via `.env`
- **ora / chalk** — CLI UX (spinners, colors)

## Architecture — Hexagonal (Ports & Adapters)

Driving adapters (входи): `cli/` (Commander.js), `mcp/` (Claude MCP)
Driven adapters (зовнішні системи): `adapters/jira/`, `adapters/jira-proxy/`, `adapters/git/`, `adapters/github/`, `adapters/db/`, `adapters/postgres/`
Dependency Rule: `cli/,mcp/ → use-cases/ → core/ports` ← `adapters/`

```
src/
├── core/                          ← CORE: types + interfaces (zero dependencies)
│   ├── types/
│   │   ├── issue.ts                  Issue, Comment, Changelog, Worklog, Link, IssueBatch
│   │   ├── github.ts                 PullRequest, Review, PullRequestFile, GitHubBatch, Release
│   │   ├── git.ts                    Commit, CommitFile, CommitIssueRef, CommitBatch, GitRef
│   │   ├── project.ts                Project
│   │   ├── config.ts                 WorkspaceConfig, SourceConfig, SourceType
│   │   └── index.ts                  re-exports
│   └── ports/
│       ├── source-provider.ts        ISourceProvider — where data comes from
│       ├── git-provider.ts           IGitProvider — Git-specific
│       ├── github-provider.ts        IGitHubProvider — GitHub-specific
│       ├── embedding-provider.ts     IEmbeddingProvider — text → vector
│       ├── storage.ts                IStorage — where data is stored
│       └── index.ts                  re-exports
│
├── use-cases/                     ← LOGIC: orchestration (depends only on core/)
│   ├── pull.ts                       PullUseCase: Jira → PostgreSQL
│   ├── pull-git.ts                   PullGitUseCase: Git → PostgreSQL
│   ├── pull-github.ts                PullGitHubUseCase: GitHub → PostgreSQL
│   └── embed.ts                      EmbedUseCase: issues → OpenAI → pgvector
│
├── adapters/                      ← IMPLEMENTATIONS: implements core/ports
│   ├── jira/                         JiraProvider implements ISourceProvider
│   │   ├── client.ts                    Version3Client wrapper
│   │   ├── mapper.ts                    Raw Jira JSON → core types
│   │   ├── provider.ts                  Paginated pull, fields=*all, expand=changelog
│   │   └── index.ts                     re-exports
│   ├── csv/                          CsvProvider — Jira CSV import
│   │   ├── parser.ts                    Header detection, date parsing
│   │   ├── mapper.ts                    CSV row → core types
│   │   ├── provider.ts                  Streaming CSV → IssueBatch
│   │   └── index.ts                     re-exports
│   ├── git/                          GitProvider — reads local repos
│   │   ├── mapper.ts                    Raw git data → core types
│   │   ├── provider.ts                  es-git walker, commit + diff extraction
│   │   └── index.ts                     re-exports
│   ├── github/                       GitHubProvider — REST API via Octokit
│   │   ├── client.ts                    Octokit wrapper
│   │   ├── provider.ts                  PRs, reviews, comments, files, releases
│   │   ├── mapper.ts                    Raw GitHub JSON → core types
│   │   └── index.ts                     re-exports
│   ├── openai/                       OpenAI embeddings adapter
│   │   ├── embedding-provider.ts        text-embedding-3-small, batched
│   │   └── index.ts                     re-exports
│   └── postgres/                     PostgresStorage implements IStorage
│       ├── connection.ts                pg Pool
│       ├── schema.ts                    CREATE TABLE + indexes (idempotent)
│       ├── storage.ts                   UPSERT logic, transactions
│       └── index.ts                     re-exports
│
├── workspace/                     ← INFRA: workspace management
│   ├── config.ts                     loadConfig(), parseConfig()
│   ├── resolver.ts                   find .argustack/ walking up from cwd
│   └── registry.ts                   global workspace registry (~/.argustack/workspaces.json)
│
├── mcp/                           ← MCP SERVER: Claude Desktop integration
│   ├── server.ts                     McpServer setup + tool registration
│   ├── helpers.ts                    Shared DB connection helper
│   ├── types.ts                      Row types for query results
│   └── tools/                        Tool modules (one per domain)
│       ├── workspace.ts                 workspace_info, list_projects, list_workspaces, switch_workspace
│       ├── query.ts                     query_commits, query_issues, query_prs, query_releases
│       ├── issue.ts                     get_issue, issue_commits, issue_prs, issue_stats, issue_timeline
│       ├── search.ts                    hybrid_search
│       ├── estimate.ts                  estimate
│       ├── push.ts                      create_issue, update_issue, push
│       └── database.ts                  db_schema, db_query, db_stats
│
└── cli/                           ← ENTRY POINT: commands, UX, wiring
    ├── index.ts                      Commander.js setup, registers all commands
    ├── init/                         argustack init (interactive workspace setup)
    │   ├── index.ts                     Init orchestrator
    │   ├── types.ts                     Setup result types, InitFlags
    │   ├── generators.ts               .env, docker-compose, config generation
    │   ├── setup-jira.ts               Jira source setup prompts
    │   ├── setup-git.ts                Git source setup prompts
    │   ├── setup-github.ts             GitHub source setup prompts
    │   ├── setup-csv.ts                CSV source setup prompts
    │   └── setup-db.ts                 Database source setup prompts
    ├── sync.ts                       argustack sync (jira, git, github, csv, db)
    ├── push.ts                       argustack push / push --updates
    ├── workspaces.ts                 argustack workspaces (list all from global registry)
    ├── embed.ts                      argustack embed (generate embeddings)
    ├── sources.ts                    argustack sources (list configured sources)
    ├── status.ts                     argustack status (workspace status)
    └── mcp-install.ts                argustack mcp install (Claude Desktop config)
```

### Key Architecture Decisions

- **core/** has ZERO dependencies on external packages — only pure TypeScript types and interfaces
- **use-cases/** depends only on core/ interfaces — doesn't know about Jira, PostgreSQL, or CLI
- **adapters/** implement core/ interfaces — each adapter is replaceable independently
- **cli/** is the composition root — creates adapters, injects them into use cases
- **AsyncGenerator** for `pullIssues()`, `pullCommits()`, `pullPullRequests()` — memory-efficient streaming of large datasets
- **GitHub is a separate SourceType** from Git — Git reads local repo, GitHub connects to API
- **Multi-repo Git** — `sync.ts` loops over multiple `GIT_REPO_PATHS`, one `GitProvider` per repo, shared storage. Backwards compatible with legacy `GIT_REPO_PATH`
- **Progress reporting** — ports expose optional `getIssueCount()`, `getCommitCount()`, `getPrCount()` for showing `150/506 issues (30%)` during sync

### Data Flow

```
CLI (sync.ts)
  → creates Provider (adapter)
  → creates PostgresStorage (adapter)
  → creates UseCase(provider, storage)
  → UseCase.execute()
       → provider.pull*()        ← AsyncGenerator yields batches
       → storage.saveBatch()     ← UPSERT into PostgreSQL
```

## Source Types

```typescript
type SourceType = 'jira' | 'git' | 'github' | 'csv' | 'db';
```

Each source is independent — own adapter, own use case, own sync command, own setup in init.

## Workspace Concept

Argustack uses a workspace pattern like git. Each workspace is a directory with `.argustack/` marker.

- `argustack init` creates a workspace: `.argustack/`, `.env`, `docker-compose.yml`, `db/init.sql`
- CLI finds workspace by walking up from cwd looking for `.argustack/`
- Each workspace has its own PostgreSQL instance (Docker) and its own credentials

## Key Principles

- **Download ALL fields** — `fields=*all`, every single field Jira returns, even if there are thousands of custom fields
- **Store as-is** — field names preserved exactly as returned, no renaming, no mapping
- **raw_json JSONB** — full original API response stored, nothing filtered or lost
- **Cross-reference** — commit messages and PR titles mentioning `PROJ-123` are linked to Jira issues
- **Zero configuration** — install, init, pull. No field mapping, no schema customization
- **Universal** — works with any Jira instance, any Git repo, any GitHub repo

## Database

- **PostgreSQL 16 + pgvector** running in Docker
- Default port: `5434` (not 5432, to avoid conflicts)
- pgweb UI on port `8086` for browsing tables and running SQL
- Schema managed by `adapters/postgres/schema.ts` (idempotent, CREATE IF NOT EXISTS)
- Template in `templates/init.sql` for initial workspace setup

### Tables

| Table | Purpose |
|-------|---------|
| `issues` | Jira issues — standard fields + `custom_fields` JSONB + `raw_json` JSONB + `embedding` vector |
| `issue_comments` | Comments per issue |
| `issue_changelogs` | Field change history |
| `issue_worklogs` | Time tracking entries |
| `issue_links` | Issue-to-issue links |
| `commits` | Git commits — hash, message, author, date, search vector |
| `commit_files` | Per-file changes — path, status, additions, deletions |
| `commit_issue_refs` | Cross-reference: commit ↔ Jira issue |
| `pull_requests` | GitHub PRs — state, author, reviewers, merge info, search vector |
| `pr_reviews` | Review approvals and change requests |
| `pr_comments` | Inline review comments with file paths |
| `pr_files` | Per-file changes in each PR |
| `pr_issue_refs` | Cross-reference: PR ↔ Jira issue |
| `releases` | GitHub releases with tags and notes |

## Configuration

`.env` file in workspace root (created by `argustack init`):
```bash
# === Jira ===
JIRA_URL=https://instance.atlassian.net
JIRA_EMAIL=user@email.com
JIRA_API_TOKEN=token
JIRA_PROJECTS=PROJ,OTHER

# === Git (comma-separated for multiple repos) ===
GIT_REPO_PATHS=/path/to/repo1,/path/to/repo2

# === GitHub ===
GITHUB_TOKEN=ghp_...
GITHUB_OWNER=org-or-user
GITHUB_REPO=repo-name

# === Jira CSV (alternative to Jira API) ===
# CSV_FILE_PATH=/path/to/Jira.csv

# === Argustack internal PostgreSQL ===
DB_HOST=localhost
DB_PORT=5434
DB_USER=argustack
DB_PASSWORD=argustack_local
DB_NAME=argustack

# === OpenAI embeddings (optional) ===
# OPENAI_API_KEY=sk-...
```

## Development

```bash
npm install                      # install dependencies
docker compose up -d             # start PostgreSQL (from workspace dir)
npm run dev -- sync              # run via tsx (dev mode)
npm run build                    # compile TypeScript
npm link                         # symlink global `argustack` to local build
npm start -- sync                # run compiled version
npm run ci                       # full check: typecheck + lint + all tests
```

## Commands

```bash
argustack init                   # create workspace (interactive)
argustack sync                   # pull all enabled sources
argustack sync jira              # pull Jira only
argustack sync git               # pull Git only
argustack sync github            # pull GitHub only (PRs, reviews, releases)
argustack sync csv               # import from Jira CSV export
argustack sync csv -f file.csv   # import specific CSV file
argustack sync db                # sync external database schema
argustack sync -p PROJ           # pull specific Jira project
argustack sync --since 2025-01-01  # incremental pull
argustack push                   # push local board tasks to Jira (source='local' → create Story → source='jira')
argustack push --updates         # push locally modified issues to Jira
argustack embed                  # generate embeddings for semantic search
argustack sources                # list configured sources
argustack status                 # workspace status
argustack workspaces             # list all workspaces (global registry)
argustack mcp install            # install MCP server into Claude Desktop
```

## Testing

```bash
npm test                         # all tests (unit + integration + MCP + architecture)
npm run test:unit                # unit only
npm run test:integration         # integration only
npm run test:mcp                 # MCP server only
npm run test:arch                # architecture tests (SSOT validator)
npm run test:watch               # watch mode
npm run test:coverage            # with coverage
npm run ci                       # typecheck + lint + all tests
npm run check                    # typecheck + lint (no tests)
```

## Git Branches

- `main` — production. All changes go through PR from staging
- `staging` — development. All code goes here first
- `feature/*` — merge into `staging` before main
- Production deploy — **always via PR** (`staging → main`)

## Quality Gates

- **Husky pre-commit hooks** — branch-aware (strict on `main`, flexible on `staging`/`feature/*`)
- **lint-staged** — ESLint on staged `.ts` files
- **Pre-commit runs**: lint-staged → TypeScript check → unit tests
- **Architecture tests** — SSOT validator (no hardcoded IDs), no eslint-disable, no inline `//` comments

## Code Conventions

- ESM modules (`"type": "module"` in package.json)
- TypeScript strict mode
- File extensions in imports: `import { foo } from './bar.js'`
- Async/await throughout
- No hardcoded field names or project-specific logic
- No eslint-disable — fix root cause with proper types
- Hexagonal Architecture: depend on ports (core/ports), not adapter implementations

## References

| File | Purpose |
|------|---------|
| `llms.txt` | LLM-friendly project summary |
| `AGENTS.md` | AI coding agent guide |
| `.claude/rules/policies.md` | Git flow, commits, TSDoc, code comments |
| `.claude/rules/tests.md` | SSOT fixtures, Vitest, test strategy by layer |
| `.claude/rules/workflows.md` | Explore → Plan → Code → Commit |
