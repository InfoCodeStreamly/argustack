# AGENTS.md — Argustack Development Guide

This file guides AI coding agents (Claude Code, GitHub Copilot, Cursor, etc.) working on this codebase.

## Build & Test

```bash
npm install                        # install dependencies
npm run dev -- sync                # run in dev mode (tsx)
npm run build                      # compile TypeScript

npm run ci                         # MUST PASS: typecheck + lint + all tests
npm run typecheck                  # TypeScript only
npm run lint                       # ESLint only

npm test                           # all test suites (unit + integration + MCP + architecture)
npm run test:unit                  # unit tests only
npm run test:integration           # integration tests (use fakes, no real DB)
npm run test:mcp                   # MCP server tests (InMemoryTransport)
npm run test:arch                  # architecture tests (SSOT validator, no-eslint-disable)
npm run test:watch                 # watch mode
```

## Architecture — Hexagonal (Ports & Adapters)

Core knows nothing about adapters. Driving adapters (entries): cli/, mcp/. Driven adapters (external systems): adapters/.

```
src/
├── core/types/        ← Domain types (Issue, PullRequest, Commit, Config) — zero dependencies
├── core/ports/        ← Interfaces (ISourceProvider, IGitProvider, IGitHubProvider, IStorage) — contracts only
├── adapters/          ← Driven adapters (jira/, git/, github/, csv/, postgres/, openai/)
├── use-cases/         ← Business logic (pull.ts, pull-git.ts, pull-github.ts, embed.ts)
├── cli/               ← Driving adapter — creates adapters, injects into use cases
├── mcp/               ← Driving adapter — MCP server for Claude Desktop / Claude Code (15 tools)
│   ├── server.ts      ← Orchestrator — registers tools, starts transport
│   ├── types.ts       ← Row interfaces for SQL queries
│   ├── helpers.ts     ← Shared utilities (loadWorkspace, textResponse, etc.)
│   └── tools/         ← Tool modules (workspace, query, issue, search, estimate)
└── workspace/         ← Config management, workspace resolver
```

**Dependency Rule:** `cli/,mcp/ → use-cases/ → core/ports` ← `adapters/`

## Code Conventions

- **ESM modules** — imports must have `.js` extensions: `import { foo } from './bar.js'`
- **TypeScript strict mode** — no `any` without good reason
- **Async/await** — throughout, no `.then()` chains
- **No hardcoded logic** — works with any Jira instance, any Git repo
- **No eslint-disable** — fix the root cause, not the linter
- **No inline comments** — only TSDoc `/** */` where types can't express the intent

## Testing Conventions

- **SSOT fixtures** — all test data in `tests/fixtures/shared/test-constants.ts`
- **Factory functions** — `createIssue()`, `createBatch()`, `createCommit()`, `createCommitBatch()`, `createPullRequest()`, `createGitHubBatch()` — never inline data
- **Test ID constants** — `TEST_IDS`, `GIT_TEST_IDS`, `GITHUB_TEST_IDS` — centralized identifiers
- **Builders** — `IssueBuilder`, `PullRequestBuilder` for complex test objects
- **Fakes** for integration tests — `tests/fixtures/fakes/` (in-memory IStorage, ISourceProvider)
- **Mocks** for unit tests — `vi.mock()` to isolate dependencies
- **Architecture tests** — scan codebase for hardcoded IDs, missing SSOT imports

## Commit Conventions

- **Format:** `type: description` (e.g., `feat: add GitHub sync command`)
- **Types:** feat, fix, refactor, docs, test, chore, perf
- **No AI signatures** — never add "Generated with Claude Code" or "Co-Authored-By"
- **No character limits** — write as much as needed
- **Never commit to main** — always staging or feature/*

## Git Workflow

- `main` — production, deploy via PR only
- `staging` — development, all code goes here first
- `feature/*` — merge into staging before main
- Pre-commit hooks: lint-staged → typecheck → unit tests

## Source Types

```typescript
type SourceType = 'jira' | 'git' | 'github' | 'csv' | 'db';
```

- **jira** — Jira Cloud/Server API → issues, comments, changelogs, worklogs, links
- **csv** — Jira CSV export → issues (no API needed, dynamic header detection)
- **git** — local repos on disk → commits, per-file diffs, issue cross-references (multi-repo via `GIT_REPO_PATHS`)
- **github** — GitHub REST API → PRs, reviews, comments, releases
- **db** — coming soon

Each source has: adapter (`src/adapters/`), use case (`src/use-cases/`), CLI command (`src/cli/sync.ts`).

All three providers expose optional `getCount()` methods for progress reporting (total/current/%). Use cases call them with try/catch — progress degrades gracefully if count unavailable.

## Database

- PostgreSQL 16 + pgvector in Docker
- Port `5434` (not 5432 — avoids conflicts)
- pgweb UI on port `8086`
- Schema in `src/adapters/postgres/schema.ts` (idempotent CREATE IF NOT EXISTS)

### Tables

**Jira:** issues, issue_comments, issue_changelogs, issue_worklogs, issue_links
**Git:** commits, commit_files, commit_issue_refs
**GitHub:** pull_requests, pr_reviews, pr_comments, pr_files, pr_issue_refs, releases

## File Map

| Path | Purpose |
|------|---------|
| `src/core/types/` | Domain types — Issue, PullRequest, Commit, Config |
| `src/core/ports/` | Interfaces — ISourceProvider, IGitProvider, IGitHubProvider, IStorage |
| `src/adapters/jira/` | Jira API client, mapper, provider |
| `src/adapters/csv/` | Jira CSV import — parser, mapper, provider |
| `src/adapters/git/` | Git repo reader (es-git / libgit2) |
| `src/adapters/github/` | GitHub REST API (Octokit) |
| `src/adapters/postgres/` | PostgreSQL storage, schema, UPSERT |
| `src/adapters/openai/` | OpenAI embeddings (text-embedding-3-small) |
| `src/use-cases/pull.ts` | PullUseCase — Jira → PostgreSQL |
| `src/use-cases/pull-git.ts` | PullGitUseCase — Git → PostgreSQL |
| `src/use-cases/pull-github.ts` | PullGitHubUseCase — GitHub → PostgreSQL |
| `src/use-cases/embed.ts` | EmbedUseCase — generate embeddings |
| `src/cli/init.ts` | Interactive workspace setup |
| `src/cli/sync.ts` | Sync commands (jira, git, github, csv) |
| `src/mcp/server.ts` | MCP server orchestrator — registers 15 tools |
| `src/mcp/tools/` | Tool modules (workspace, query, issue, search, estimate) |
| `tests/fixtures/shared/` | SSOT test constants and factories |
| `tests/fixtures/builders/` | IssueBuilder, PullRequestBuilder |
| `tests/fixtures/fakes/` | In-memory fakes for integration tests |
| `tests/architecture/` | Meta-tests: SSOT validator, no-eslint-disable |

## Debugging

**"Module not found"** → check `.js` extension in import path
**Test data mismatch** → update `tests/fixtures/shared/test-constants.ts`, not individual tests
**Type errors** → check `src/core/types/` for current definitions
**DB connection** → port is 5434, check `.env`, run `docker compose up -d`
**Pre-commit fails** → run `npm run ci` to see what's broken, fix it, commit again
