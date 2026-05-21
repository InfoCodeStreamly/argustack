# Argustack

[![npm version](https://img.shields.io/npm/v/argustack.svg)](https://www.npmjs.com/package/argustack)
[![npm downloads](https://img.shields.io/npm/dm/argustack.svg)](https://www.npmjs.com/package/argustack)
[![license](https://img.shields.io/npm/l/argustack.svg)](LICENSE)

**Ask AI about your Jira, Git, and GitHub — powered by local data, not cloud APIs.**

Argustack downloads your project data into a local hub (Postgres + Neo4j + Qdrant), indexes your codebases with tree-sitter, and gives Claude direct access via 46 MCP tools. All data stays on your machine.

> *Was ticket PROJ-123 implemented as described?*
> *Who reviewed the PR and what was the feedback?*
> *How long will it take Sarah to fix this bug?*

## Features

- **Jira / Jira Proxy / CSV** — issues, comments, changelogs, worklogs, links, all custom fields
- **Git** — commits, per-file diffs, automatic issue cross-references
- **GitHub** — PRs, reviews, comments, releases, automatic issue cross-references
- **External DB** — schema introspection + read-only SQL against your app database
- **Cross-source timeline** — Jira + Git + GitHub events in chronological order
- **Semantic search** — find issues by meaning, not just keywords (pgvector)
- **Task estimation** — predict duration per developer based on actual history
- **Knowledge graph** — entity-relationship graph (issues, developers, modules, PRs) with impact analysis
- **Code intelligence** — Cursor-style RAG: tree-sitter AST + Neo4j call graph + Qdrant semantic search. Default embeddings via Ollama (`nomic-embed-text`, 768d); LM Studio and Voyage AI are opt-ins.
- **Multi-tenant hub** — one Postgres + Neo4j + Qdrant stack in `~/.argustack/`, many workspaces inside it (CASCADE-isolated by `workspace_id`).
- **46 MCP tools** — Claude queries your data via SQL + Cypher + vector search. Every tool advertises `title` + `readOnly/destructive` annotations so Claude Desktop can warn before write operations.
- **IDE Plugin** — kanban board for JetBrains IDEs where columns are Claude Code skills.
- **100% local** — no cloud, no accounts, no telemetry.

## Quick Start

```bash
npm i -g argustack

# 1. Bootstrap the hub (Postgres + Neo4j + Qdrant + pgweb + optional Ollama).
argustack init

# 2. Create a workspace and bind your sources.
argustack workspace add my-project
argustack add jira   --workspace my-project --url https://team.atlassian.net --email you@co.com --token ATATT...
argustack add git    --workspace my-project --path /path/to/repo
argustack add github --workspace my-project --owner org --repo repo --token ghp_...
argustack add code   --workspace my-project --root /path/to/repo

# 3. Sync data and (optionally) index code.
argustack sync --workspace my-project
argustack code index --project my-project

# 4. Connect Claude.
argustack mcp install
```

That's it. Ask Claude about your project.

`argustack init` auto-installs missing dependencies (Docker via OrbStack, Ollama with `nomic-embed-text`), resolves port conflicts, and applies the hub schema. For the full decision flow and every branch (auto-install vs manual, port conflicts, re-init detection, LLM probe error classification), see **[AGENTS.md → Init Flow](./AGENTS.md#init-flow)**.

## IDE Plugin

Kanban board inside JetBrains IDEs (IntelliJ, WebStorm, PyCharm, …) where columns are Claude Code skills. Drag a task card to a skill column and Claude executes it.

- Cards are Markdown files in `Docs/Tasks/`
- Columns auto-discovered from `.claude/skills/`
- Workflows group skills into pipelines (plan, implement, test, review)

Download from [GitHub Releases](https://github.com/CodeStreamly/argustack/releases) and install via Settings → Plugins → Install from Disk.

The CLI and IDE plugin are independent — the plugin works without the CLI.

## Security

Argustack is a CLI tool with no backend, no cloud, no accounts. Credentials live in `~/.argustack/config.env` on your machine (chmod 600). Data lives in PostgreSQL + Neo4j + Qdrant on `localhost`. Nothing is uploaded anywhere unless you opt into Voyage AI / OpenAI embeddings.

## Documentation

- **[AGENTS.md](./AGENTS.md)** — full CLI command reference, MCP tool reference (46 tools), init flow diagram, architecture, file map, hub schema, debugging
- **[llms.txt](./llms.txt)** — LLM-friendly project summary (read this if you're Claude)
- **[CLAUDE.md](./CLAUDE.md)** — architecture, tech stack, workspace concept, contributor conventions

## License

MIT
