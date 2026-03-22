---
name: create-technical-plan
description: "Creates a Technical Plan for an Argustack feature by exploring the codebase layer-by-layer through the Hexagonal Architecture (Core → Adapters → Use Cases → CLI/MCP → Tests). Appends the plan to an existing business requirement .md file in Docs/Tasks/ToDo/. Use after /create-business-requirements when the business part is ready and you need to plan the implementation — or when the user says 'technical plan', 'tech plan', 'план реалізації', 'технічний план', 'add implementation details', 'plan the layers'."
argument-hint: "[path to .md or feature description]"
---

# Technical Plan Creator — Argustack

Appends a Technical Plan to an existing business requirement document.

**How it works:** We open the real codebase — `tree`, `Read`, `Grep` — and see what's actually there. Based on what we find, we decide what to add, modify, or delete. Every line in the plan comes from reading actual code, not from memory or assumptions.

**Ground rules:**
- **Read real code** — `tree` to see structure, `Read` to see content. Never invent file paths or method names
- **All 5 phases, every time** — Core, Adapters, Use Cases, CLI/MCP, Tests. Even if a layer has no changes, state that explicitly with justification
- **Dependency Rule** — `cli/,mcp/ → use-cases/ → core/ports` ← `adapters/`. If the plan violates this, fix it
- **Paths from `src/`** — all file paths relative to project root (e.g., `src/core/types/foo.ts`)
- **No Plan Mode** — write the MD plan directly, do not use EnterPlanMode

## Workflow

### Step 1: Find the Business Requirement

If `$ARGUMENTS` is a file path — read it directly.

Otherwise, find the file:
```bash
ls Docs/Tasks/ToDo/
```

Ask the user which feature to plan. Read the full business requirement:
- User Story, Business Goal — understand WHAT we're building
- Acceptance Criteria — these drive the technical plan
- Edge Cases — these affect implementation
- Dependencies — check if blocking work is done

### Step 2: Layer-by-Layer Exploration

One layer at a time. For EACH layer:

```
1. TREE   → tree src/{layer}/ -L 3       (see what exists)
2. READ   → Read files that will be affected  (see methods, fields, types)
3. PLAN   → Decide: what to add, modify, delete — based on what you read
4. NEXT   → Only after plan for this layer is written
```

If unsure about a method or API — read the file or use Context7. Do not guess.

**Layer order (mandatory):**

#### Phase 1: Core Layer
```bash
tree src/core/ -L 3
```
- Read files that will be modified
- Plan: what types, interfaces, ports to add/modify/create
- **Artifacts checklist:**
  - Types (`core/types/`) — new domain types, fields, enums?
  - Ports (`core/ports/`) — new provider/storage interfaces?
  - Re-exports (`core/types/index.ts`, `core/ports/index.ts`) — updated?

#### Phase 2: Adapters Layer
```bash
tree src/adapters/ -L 3
```
- Read files that will be modified
- Plan: what providers, mappers, storage methods to add/modify
- **Artifacts checklist:**
  - New adapter directory (`adapters/{name}/`) — for new data source?
  - Provider (`provider.ts`) — implements core port interface?
  - Mapper (`mapper.ts`) — raw API/data → core types?
  - Storage methods (`postgres/storage.ts`) — new UPSERT/query methods?
  - Schema (`postgres/schema.ts`) — new tables, columns, indexes?
  - Client wrapper — API client setup?
  - Index file — re-exports?

#### Phase 3: Use Cases
```bash
tree src/use-cases/ -L 2
```
- Read files that will be modified
- Plan: what use cases to add/modify
- **Artifacts checklist:**
  - New use case file — one per business operation (Pull*, Query*, etc.)?
  - Constructor signature — which ports injected?
  - Execute method — AsyncGenerator or Promise?
  - Progress reporting — `getCount()` method on provider?

#### Phase 4: CLI + MCP
```bash
tree src/cli/ -L 3
tree src/mcp/ -L 3
```
- Read files that will be modified
- Plan: what commands, MCP tools, wiring to add/modify
- **Artifacts checklist:**
  - CLI command (`cli/*.ts`) — new subcommand or modify existing?
  - CLI init flow (`cli/init/`) — new source setup prompts?
  - MCP tool files (`mcp/tools/*.ts`) — new tools with inputSchema + handler?
  - MCP server registration (`mcp/server.ts`) — register new tools?
  - Wiring — CLI creates adapters, injects into use cases?
  - Config types (`core/types/config.ts`) — new SourceConfig fields?
  - Workspace config (`workspace/config.ts`) — parse new env vars?

#### Phase 5: Tests
```bash
tree tests/ -L 3 -d
```
- Read existing fixtures and fakes relevant to this feature
- Plan: what fixtures, fakes, unit tests, integration tests to add/modify
- **Artifacts checklist:**
  - Fixtures (`tests/fixtures/shared/test-constants.ts`) — new factory functions, test IDs?
  - Fakes (`tests/fixtures/fakes/`) — new fake provider/storage?
  - Unit tests (`tests/unit/adapters/`) — mapper, provider, storage tests?
  - Integration tests (`tests/integration/use-cases/`) — use case with fakes?
  - MCP tests (`tests/mcp/`) — new tool tests via InMemoryTransport?
  - Architecture tests (`tests/architecture/`) — SSOT validator updates?

### Step 3: Write the Technical Plan

Append to the SAME business requirement file:

```markdown
---

## Technical Plan

### Phase 1: Core Layer
| File | Action | What |
|------|--------|------|
| `src/core/types/x.ts` | CREATE | new type `TableInfo`, `ColumnInfo`, `DbSchema` |

### Phase 2: Adapters Layer
| File | Action | What |
|------|--------|------|
| `src/adapters/db/provider.ts` | CREATE | `DbProvider` implements `IDbProvider` |

### Phase 3: Use Cases
| File | Action | What |
|------|--------|------|
| `src/use-cases/pull-db.ts` | CREATE | `PullDbUseCase.execute()` — schema introspection |

### Phase 4: CLI + MCP
| File | Action | What |
|------|--------|------|
| `src/cli/sync.ts` | MODIFY | add `syncDb()` function |

### Phase 5: Tests
| File | Action | What |
|------|--------|------|
| `tests/fixtures/shared/test-constants.ts` | MODIFY | add `DB_TEST_IDS`, `createTableInfo()` |

## Database Schema
{New tables in Argustack's own PostgreSQL, or "NO CHANGES"}

## Environment Variables
{New .env variables or "NO NEW VARIABLES"}

## Dependencies (npm)
{New packages or "NO NEW PACKAGES"}

## Performance Considerations
{Impact on sync time, memory, connection pooling}
```

### Step 4: Add Contracts (when needed)

Add Contracts for CREATE actions with business logic. Not needed for simple MODIFY with 1-3 fields.

Tree-style format under the phase table:

```markdown
**Contracts:**

DbProvider
├── constructor(config: DbConnectionConfig)
├── connect(): Promise<void>
│   logic: SET default_transaction_read_only = true on session
├── introspect(): AsyncGenerator<TableInfo>
│   logic: information_schema queries, yields per-table
├── query(sql: string): Promise<QueryResult>
│   logic: allowlist validation → BEGIN READ ONLY → execute → COMMIT
└── disconnect(): Promise<void>
```

### Step 5: Review with User

Present the plan for review. The user may want to:
- Adjust scope (remove/add files)
- Change approach for specific layers
- Add/remove contracts
- Modify method signatures

### Step 6: Quality Checklist

- [ ] All 5 phases present in Technical Plan
- [ ] File paths verified via `tree` (not from memory)
- [ ] Actions: CREATE, MODIFY, DELETE only
- [ ] Method/field names in What column
- [ ] Contracts for CREATE files with business logic
- [ ] No code snippets or implementation details in the plan
- [ ] Dependency Rule respected: core/ has zero external imports, adapters/ implement core/ports, use-cases/ depend only on core/
- [ ] Database Schema section present (even if "NO CHANGES")
- [ ] Environment Variables section present (even if "NO NEW VARIABLES")
- [ ] Dependencies (npm) section present (even if "NO NEW PACKAGES")
- [ ] Performance Considerations present

## Plan Rules

### REQUIRED in plan:
- Exact file paths (from `tree`)
- Method/field names
- Actions: CREATE, MODIFY, DELETE

### FORBIDDEN in plan:
- Code snippets
- Implementation details (SQL queries, if/else logic, loops)
- Generic descriptions ("update the component", "add functionality")

### What Column Format:
| Type | Format |
|------|--------|
| Method | `add/modify/remove methodName()` |
| Field/Type | `add fieldName: Type` |
| Interface | `add/modify InterfaceName` |
| Enum | `add EnumName` |
| Export | `add re-export` |

### No changes in a layer?
Write `NO CHANGES` with justification. Don't skip the phase.

Example: `| - | NO CHANGES | Reusing existing PostgresStorage — no new tables or queries needed |`

Challenge "NO CHANGES" — is it real? If Core has new types but Use Cases says "NO CHANGES", that's almost certainly wrong.

## Output

After completing the plan, summarize:
- **File:** path to updated .md
- **Phases with changes:** which layers are affected
- **New files:** N files to CREATE
- **Modified files:** N files to MODIFY
- **Contracts:** N contracts written
- **New npm packages:** list or "none"
- **Next step:** verify with `/verify-technical-plan`, then implement
