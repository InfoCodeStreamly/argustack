---
name: refactor-code
description: "Finds the largest source files sorted by size and refactors them one at a time following Hexagonal Architecture (Ports & Adapters) principles — internal cleanup first, then incremental extraction. Covers layer violations, file splitting, dead code removal, DI/coupling fixes, and code quality. Use this skill whenever the user mentions refactoring code, cleaning up source files, architecture violations, large files, code quality issues, or says things like 'рефактор коду', 'відрефактори', 'clean up code', 'refactor this', 'великий файл', 'порушення архітектури'. Also trigger when user wants to fix architecture violations, split large components, reduce file complexity, or improve code structure."
---

# Hexagonal Architecture Code Refactoring — Argustack

You are a Code Refactoring Specialist for **Argustack** — TypeScript CLI + MCP server, **Hexagonal Architecture (Ports & Adapters)**.

**Tech stack:** TypeScript / Node.js, Commander.js, PostgreSQL 16 + pgvector, MCP SDK, ESM modules.

**Driving adapters** (входи): `cli/` (Commander.js), `mcp/` (Claude MCP)
**Driven adapters** (зовнішні системи): `adapters/jira/`, `adapters/git/`, `adapters/github/`, `adapters/postgres/`
**Dependency Rule:** `cli/,mcp/ → use-cases/ → core/ports` ← `adapters/`

**The #1 rule: ONE file at a time.** Pick the largest file, read it completely, understand it deeply, refactor it piece by piece. After one file — STOP. Fresh context for the next one.

**The #2 rule: Clean inside FIRST, extract SECOND.** Before splitting a file or moving code out, make the existing code clean: remove dead code, fix naming, simplify logic, reduce duplication. Only then start extracting pieces. This prevents moving garbage to new locations.

## Before You Start

1. Run `date` — know the current date
2. During analysis, use **Context7 MCP** to verify APIs before proposing changes — libraries evolve, docs may be outdated

## Step 1: Find the Next Candidate

```bash
find src/ -name '*.ts' -not -name '*.test.ts' -not -name '*.spec.ts' -not -path '*/node_modules/*' | xargs wc -l | sort -rn | head -20
```

Start with the largest files unless the user specifies a file or directory. Present the list and pick **the first one** (largest file). Ask to confirm.

If the user provides a specific file path — skip discovery and go to Step 2.

**After refactoring one file — STOP.** Tell the user to run `/refactor-code` again for the next.

## Step 2: Deep Analysis

Read the entire file. Identify the Hexagonal Architecture layer:

```
src/
├── core/              ← CORE: types + ports (ZERO dependencies)
│   ├── types/            Pure TypeScript types: Issue, Commit, PullRequest, etc.
│   └── ports/            Ports: IStorage, ISourceProvider, IGitProvider, IGitHubProvider
├── use-cases/         ← APPLICATION: orchestration (depends ONLY on core/)
│   ├── pull.ts           PullUseCase: Jira → PostgreSQL
│   ├── pull-git.ts       PullGitUseCase: Git → PostgreSQL
│   ├── pull-github.ts    PullGitHubUseCase: GitHub → PostgreSQL
│   └── embed.ts          EmbedUseCase: issues → OpenAI → pgvector
├── adapters/          ← DRIVEN ADAPTERS: implements core/ports
│   ├── jira/             JiraProvider implements ISourceProvider
│   ├── csv/              CsvProvider — Jira CSV import
│   ├── git/              GitProvider — local repos via es-git
│   ├── github/           GitHubProvider — REST API via Octokit
│   ├── openai/           Embeddings adapter
│   └── postgres/         PostgresStorage implements IStorage
├── workspace/         ← INFRA: config + resolver
├── mcp/               ← DRIVING ADAPTER: Claude MCP integration
└── cli/               ← DRIVING ADAPTER: composition root, Commander.js commands
```

| Layer | Can import | CANNOT import |
|-------|-----------|---------------|
| `core/` | Nothing (pure types) | Anything external |
| `use-cases/` | `core/` only | adapters, cli, mcp |
| `adapters/` | `core/` | cli, mcp, other adapters |
| `mcp/` | `adapters/` via storage | cli |
| `cli/` | Everything (composition root) | — |

Analyze across five dimensions:

### 2.1 Internal Cleanup (do this FIRST)

Before touching architecture, clean the code itself:

| Issue | Example | Fix |
|-------|---------|-----|
| Dead code | Unused functions, commented-out blocks | Delete it. Git remembers |
| Duplicate logic | Same calculation in 3 methods | Extract private method |
| Poor naming | `handleData`, `processStuff`, `temp` | Rename to intent: `upsertIssues`, `mapToCommit` |
| Over-complex conditions | Nested ternaries, 5-level if/else | Early returns, guard clauses |
| Magic numbers/strings | `if (status === 3)` | Use typed constant or enum |
| Unused imports | Imports that linter missed | Remove |
| Inline comments `//` | Against project rules | Remove or convert to TSDoc if it's a business rule |

### 2.2 Layer Violations

Check imports against the dependency rule: `cli/ → use-cases/ → core/ports` ← `adapters/`

| Violation | Example | Fix |
|-----------|---------|-----|
| Core imports adapter | `import { pg } from 'pg'` in type | Remove. Core is pure |
| Use Case imports adapter | `import { PostgresStorage }` in use case | Use `IStorage` interface |
| Adapter imports CLI | `import { cliOption }` in provider | Extract to proper layer |
| MCP imports core directly bypassing adapters | Direct DB queries OK for MCP read tools | Document exception |

### 2.3 File Splitting Opportunities

| Signal | Action |
|--------|--------|
| File 500+ lines with multiple concerns | Split into focused modules |
| Multiple unrelated functions in one file | Group by responsibility |
| Provider doing mapping + API calls + caching | Extract mapper, separate concerns |
| CLI command with business logic | Move logic to use case |

### 2.4 DI and Coupling Issues

| Issue | Fix |
|-------|-----|
| Direct instantiation in use case | Accept via constructor (DI) |
| Hard dependency on specific adapter | Create interface in core/, implement in adapters/ |
| Tight coupling between modules | Extract shared logic to utility |

### 2.5 Performance Concerns

| Issue | Fix |
|-------|-----|
| Sequential DB queries that could be parallel | Use `Promise.all` where safe |
| N+1 query patterns | Batch queries, use `WHERE IN` |
| Large object creation in hot paths | Pre-compute or cache |
| Unbounded data loading | Add pagination or streaming |

## Step 3: Present Refactoring Plan

Present findings with concrete actions. Use `AskUserQuestion` for confirmation:

```
## Refactoring Plan: [filename] ([layer]) — N lines

### Phase 1: Internal Cleanup
- [ ] Remove dead code (lines X-Y: unused function `foo`)
- [ ] Fix naming: `handleData` → `upsertIssuesBatch`
- [ ] Remove N inline `//` comments

### Phase 2: Layer Violation Fixes
- [ ] Replace direct adapter import with port interface
- [ ] Move business logic from CLI to use case

### Phase 3: Extract & Split
- [ ] Extract mapper to own file (~80 lines)
- [ ] Extract helper functions (~60 lines)

### Phase 4: DI / Coupling
- [ ] Replace direct instantiation with DI

### Estimated Impact
- Lines: 1268 → ~600 (main) + ~300 (mapper) + ~80 (helpers)
- Architecture: 2 layer violations fixed
```

Wait for user confirmation. They may say "skip Phase 3, just cleanup" — respect that.

## Step 4: Execute — Incrementally

**One change at a time.**

```
1. Pick ONE change from the plan (e.g., "remove dead code")
2. Apply it
3. Brief report: "Removed 3 dead functions (45 lines). Next: fix naming."
4. Pick the next change
5. Repeat
```

**Order of operations:**

1. **Internal cleanup** — dead code, naming, simplify. Smallest diff, biggest clarity gain
2. **Layer violation fixes** — fix wrong imports, move logic to correct layer
3. **DI / coupling** — replace direct deps with interfaces
4. **Extract & split** — only after the code is clean. Split by concern into new files
5. **Performance** — query optimization, parallelization

After creating new files, verify:
- ESM imports with `.js` extensions
- No `//` comments
- Correct layer placement
- TypeScript compiles clean

Do NOT run the full test suite or build. The user verifies when ready.

## Step 5: Summary

```
## Refactoring Complete: [filename]

### Changes Applied
- Internal: removed 45 lines dead code, renamed 3 functions
- Architecture: fixed 2 layer violations
- Split: extracted Mapper (80 lines), helpers (60 lines)

### Before/After
- Lines: 1268 → 628 (main) + 312 (Mapper) + 84 (helpers)
- Layer violations: 2 → 0
- Inline comments: 5 → 0

### Files Modified/Created
- MODIFIED: src/adapters/postgres/storage.ts
- CREATED: src/adapters/postgres/mapper.ts
- CREATED: src/adapters/postgres/helpers.ts

### Next Candidate
  1.  1210  src/mcp/server.ts
  2.  890   src/adapters/jira/provider.ts
  ...

Run `/refactor-code` again for the next file.
```

## Rules (Quick Reference)

| Rule | Why it matters here |
|------|---------------------|
| Clean inside FIRST | Don't move garbage to new locations |
| ESM imports with `.js` | Project convention — `import { foo } from './bar.js'` |
| No `//` comments | Remove during cleanup, don't add new |
| Hexagonal rule | Core ← Use Cases ← Driven Adapters; Driving Adapters → Use Cases → Core |
| Context7 for APIs | Verify library APIs before using them |
| AskUserQuestion | When unsure about a split boundary — ask |
| No git operations | User commits when ready |
| TSDoc for business rules | Only when types can't express the rule |
