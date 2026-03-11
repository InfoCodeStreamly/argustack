# Argustack

**Project analysis platform — Jira + Git + DB**

Argustack cross-references three sources of truth to analyze your project:

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│    JIRA      │     │     GIT      │     │      DB      │
│  what was    │     │  what was    │     │  what actually│
│  planned     │     │  built       │     │  exists      │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                    │
       └────────────────────┼────────────────────┘
                            │
                    ┌───────▼───────┐
                    │   ARGUSTACK   │
                    └───────┬───────┘
                            │
                    ┌───────▼───────┐
                    │   Verdict     │
                    └───────────────┘
```

- Is this bug still relevant or already fixed?
- Was the feature implemented as described in the ticket?
- Does the code match the specification?
- Is the data in the DB correct or corrupted?
- Root cause — code, infrastructure, or data?

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [Docker](https://www.docker.com/) (or [OrbStack](https://orbstack.dev/) / Podman)

### Install

```bash
npm i -g argustack
```

### Setup workspace

```bash
argustack init
```

Interactive setup — asks where to create, your Jira credentials, tests the connection:

```
? Workspace directory: ~/Desktop/Marketing
? Jira URL: https://your-team.atlassian.net
? Email: you@company.com
? API Token: ****

Testing connection... OK (found 3 projects: MKT, BRAND, WEB)

? Projects to pull [all]: MKT,BRAND

Created workspace at ~/Desktop/Marketing
```

Then `cd` into it:

```bash
cd ~/Desktop/Marketing
```

### Start database

```bash
docker compose up -d
```

### Pull from Jira

```bash
argustack jira pull
```

Done. All your Jira issues are now in PostgreSQL. Browse them at [localhost:8086](http://localhost:8086).

## How It Works

### Jira Pull

Downloads **everything** from your Jira instance:
- All issues with **all fields** (standard + custom) — stored as-is, no renaming
- Comments, changelogs, worklogs, issue links
- Full raw JSON response preserved in database

```bash
argustack jira pull              # pull all configured projects
argustack jira pull -p PROJ      # pull specific project
argustack jira pull --since 2025-01-01  # incremental pull
```

### Storage

All data goes into local PostgreSQL (with pgvector for semantic search):

| Table | What's in it |
|-------|-------------|
| `issues` | All issues — typed columns + `raw_json` JSONB with full API response |
| `issue_comments` | Comments |
| `issue_changelogs` | Field change history |
| `issue_worklogs` | Time tracking |
| `issue_links` | Issue relationships |

Every custom field is preserved exactly as Jira returns it. If your Jira has 500 custom fields — all 500 are stored.

## Multiple Jira Instances

Each Jira = separate workspace directory (like git repos):

```
~/projects/
├── company-alpha/        # argustack init → connects to Alpha's Jira
│   ├── .argustack/
│   ├── .env              # Alpha credentials
│   └── docker-compose.yml
│
├── company-beta/         # argustack init → connects to Beta's Jira
│   ├── .argustack/
│   ├── .env              # Beta credentials
│   └── docker-compose.yml
```

## Configuration

After `argustack init`, edit `.env` in your workspace:

```bash
# Jira (required)
JIRA_URL=https://your-instance.atlassian.net
JIRA_EMAIL=your@email.com
JIRA_API_TOKEN=your_api_token
JIRA_PROJECTS=PROJ,OTHER

# PostgreSQL (defaults work out of the box)
DB_HOST=localhost
DB_PORT=5434
DB_USER=argustack
DB_PASSWORD=argustack_local
DB_NAME=argustack
```

> **Jira API Token**: Generate at [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens)

## Commands

```bash
argustack init                   # create workspace
argustack jira pull              # pull all issues from Jira
argustack status                 # show workspace status
```

## Tech Stack

- **TypeScript / Node.js** — CLI
- **Commander.js** — CLI framework
- **jira.js** — Jira REST API client
- **PostgreSQL + pgvector** — storage + vector search
- **Docker** — database infrastructure

## License

MIT
