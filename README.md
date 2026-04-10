# Argustack

[![npm version](https://img.shields.io/npm/v/argustack.svg)](https://www.npmjs.com/package/argustack)
[![npm downloads](https://img.shields.io/npm/dm/argustack.svg)](https://www.npmjs.com/package/argustack)
[![license](https://img.shields.io/npm/l/argustack.svg)](LICENSE)
[![docs](https://img.shields.io/badge/docs-DataRoom-blue)](https://app.paperlink.online/s/0aa7d2d6/argustack)

**Ask AI about your Jira, Git, and GitHub — powered by local data, not cloud APIs.**

[**Documentation & Examples →**](https://app.paperlink.online/s/0aa7d2d6/argustack)

Argustack downloads your project data into local PostgreSQL, cross-references everything, and gives Claude direct access via 32 MCP tools. All data stays on your machine.

> *Was ticket PROJ-123 implemented as described?*
> *Who reviewed the PR and what was the feedback?*
> *How long will it take Sarah to fix this bug?*

## Features

- **Jira** — issues, comments, changelogs, worklogs, links, all custom fields
- **Jira Proxy** — connect through company proxy/gateway, not just direct API
- **Git** — commits, per-file diffs, automatic issue cross-references
- **GitHub** — PRs, reviews, comments, releases, automatic issue cross-references
- **CSV import** — Jira CSV export for teams without API access
- **DB** — external database schema introspection and read-only queries
- **Cross-source timeline** — Jira + Git + GitHub events in chronological order
- **Semantic search** — find issues by meaning, not just keywords (pgvector)
- **Task estimation** — predict duration per developer based on actual history
- **Update & push** — modify issues locally, push changes back to Jira (Markdown descriptions auto-converted to rich ADF)
- **Global workspace registry** — `~/.argustack/workspaces.json`, switch between workspaces from any directory
- **Knowledge graph** — entity-relationship graph (issues, developers, modules, PRs) with impact analysis and code dependencies
- **32 MCP tools** — Claude queries your data directly via SQL
- **IDE Plugin** — kanban board for JetBrains IDEs where columns are Claude Code skills
- **100% local** — no cloud, no accounts, no telemetry

## Quick Start

```bash
npm i -g argustack
argustack init          # interactive setup — sources, credentials, Docker
argustack sync          # pull all data
argustack mcp install   # connect to Claude Desktop
```

That's it. Ask Claude about your project.

### Non-interactive mode

For AI agents and CI/CD — pass everything as flags:

```bash
argustack init --no-interactive \
  --source jira,git,github \
  --jira-url "https://your-team.atlassian.net" \
  --jira-email "you@company.com" \
  --jira-token "your-jira-api-token" \
  --jira-projects PROJ,MKT \
  --git-repo /path/to/repo \
  --github-token "your-github-pat" \
  --github-owner your-org \
  --github-repo your-repo
```

## Commands

```bash
argustack init                       # create workspace
argustack sync                       # pull all sources
argustack sync jira|git|github|csv|db  # pull specific source
argustack sync --since 2025-01-01    # incremental pull
argustack push                       # push local board tasks to Jira
argustack push --updates             # push locally modified issues to Jira
argustack embed                      # generate embeddings (requires OpenAI key)
argustack mcp install                # connect to Claude Desktop
argustack sources                    # list configured sources
argustack status                     # workspace info
argustack workspaces                 # list all known workspaces
argustack graph build                # build knowledge graph from synced data
argustack graph stats                # show graph entity/relationship counts
```

## MCP Tools

After sync, Claude queries your data through these tools:

| Tool | Purpose |
|------|---------|
| `query_issues` | Search issues — full-text, filters, raw SQL |
| `get_issue` | Full issue details with comments and changelogs |
| `issue_stats` | Aggregates by status, type, assignee |
| `pull_jira` | Sync latest data from Jira |
| `list_projects` | Available Jira projects |
| `query_commits` | Search commits by text, author, date, file |
| `issue_commits` | All commits mentioning a Jira issue key |
| `commit_stats` | Top authors, most changed files |
| `query_prs` | Search PRs by text, state, author |
| `issue_prs` | All PRs mentioning a Jira issue key |
| `query_releases` | List releases with search |
| `issue_timeline` | Full chronological timeline: Jira + Git + GitHub |
| `hybrid_search` | Find similar issues by meaning (keyword + optional pgvector) |
| `estimate` | Predict task duration per developer |
| `create_issue` | Create new issue locally, then push to Jira |
| `update_issue` | Update issue fields locally, then push to Jira |
| `push` | Push local/modified issues to Jira (mode: create or updates) |
| `workspace_info` | Current workspace configuration |
| `switch_workspace` | Switch active workspace by name |
| `list_workspaces` | List all workspaces (local + global registry) |
| `db_schema` | Browse external database schema (tables, columns, FKs) |
| `db_query` | Execute read-only SQL on your application database |
| `db_stats` | External database statistics |
| `impact_analysis` | What issues, developers, PRs are connected to a file/module |
| `developer_expertise` | Who knows this area best (by commits, reviews) |
| `related_issues` | Find issues connected through code, not just Jira links |
| `code_dependencies` | Co-change analysis, imports, package deps |
| `business_context` | Which business processes involve a topic |
| `build_business_graph` | Claude identifies business processes from issue data |
| `add_relationship` | Manually add semantic relationships (survives rebuild) |
| `add_observation` | Add knowledge notes to any entity |

## IDE Plugin

Kanban board inside JetBrains IDEs (IntelliJ, WebStorm, PyCharm, etc.) where columns are Claude Code skills. Drag a task card to a skill column and Claude executes it.

- Cards are Markdown files in `Docs/Tasks/`
- Columns auto-discovered from `.claude/skills/`
- Workflows group skills into pipelines (plan, implement, test, review)
- Done column has configurable time filter

Download from [GitHub Releases](https://github.com/InfoCodeStreamly/argustack/releases) and install via Settings, Plugins, Install from Disk.

The CLI and IDE plugin are independent. The plugin works without the CLI. The CLI adds analytics when configured.

## Security

Argustack is a CLI tool with no backend, no cloud, no accounts. Credentials stay in `.env` on your machine. Data stays in PostgreSQL on `localhost`. Nothing is uploaded anywhere.

## Documentation

Full documentation available at **[Argustack DataRoom](https://app.paperlink.online/s/0aa7d2d6/argustack)**:

- **Quick Start Guide** — from zero to first query in 5 minutes
- **Use Cases & Examples** — real scenarios for PMs, team leads, developers, CTOs
- **MCP Tools Reference** — all 32 tools with parameters and examples
- **Estimate Tool Deep Dive** — algorithm, scoring, data sources
- **Architecture Guide** — hexagonal architecture, directory structure, extending

## License

MIT
