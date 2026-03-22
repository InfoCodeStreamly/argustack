# Argustack

[![npm version](https://img.shields.io/npm/v/argustack.svg)](https://www.npmjs.com/package/argustack)
[![npm downloads](https://img.shields.io/npm/dm/argustack.svg)](https://www.npmjs.com/package/argustack)
[![license](https://img.shields.io/npm/l/argustack.svg)](LICENSE)
[![docs](https://img.shields.io/badge/docs-DataRoom-blue)](https://app.paperlink.online/s/0aa7d2d6/argustack)

**Ask AI about your Jira, Git, and GitHub — powered by local data, not cloud APIs.**

[**Documentation & Examples →**](https://app.paperlink.online/s/0aa7d2d6/argustack)

Argustack downloads your project data into local PostgreSQL, cross-references everything, and gives Claude direct access via 20 MCP tools. All data stays on your machine.

> *Was ticket PROJ-123 implemented as described?*
> *Who reviewed the PR and what was the feedback?*
> *How long will it take Sarah to fix this bug?*

## Features

- **Jira** — issues, comments, changelogs, worklogs, links, all custom fields
- **Git** — commits, per-file diffs, automatic issue cross-references
- **GitHub** — PRs, reviews, comments, releases, automatic issue cross-references
- **CSV import** — Jira CSV export for teams without API access
- **Cross-source timeline** — Jira + Git + GitHub events in chronological order
- **Semantic search** — find issues by meaning, not just keywords (pgvector)
- **Task estimation** — predict duration per developer based on actual history
- **20 MCP tools** — Claude queries your data directly via SQL
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
argustack sync jira|git|github|csv   # pull specific source
argustack sync --since 2025-01-01    # incremental pull
argustack embed                      # generate embeddings (requires OpenAI key)
argustack mcp install                # connect to Claude Desktop
argustack sources                    # list configured sources
argustack status                     # workspace info
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
| `semantic_search` | Find similar issues by meaning (pgvector) |
| `estimate` | Predict task duration per developer |
| `workspace_info` | Current workspace configuration |

## Security

Argustack is a CLI tool with no backend, no cloud, no accounts. Credentials stay in `.env` on your machine. Data stays in PostgreSQL on `localhost`. Nothing is uploaded anywhere.

## Documentation

Full documentation available at **[Argustack DataRoom](https://app.paperlink.online/s/0aa7d2d6/argustack)**:

- **Quick Start Guide** — from zero to first query in 5 minutes
- **Use Cases & Examples** — real scenarios for PMs, team leads, developers, CTOs
- **MCP Tools Reference** — all 15 tools with parameters and examples
- **Estimate Tool Deep Dive** — algorithm, scoring, data sources
- **Architecture Guide** — hexagonal architecture, directory structure, extending

## License

MIT
