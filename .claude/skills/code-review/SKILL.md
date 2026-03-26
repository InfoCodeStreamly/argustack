---
name: code-review
description: "Reviews code changes file-by-file against Argustack's Hexagonal Architecture (Ports & Adapters), TypeScript best practices, and project conventions. Checks dependency rule violations, type safety, port/adapter contracts, test coverage gaps, and code quality. Researches any disputed or uncertain pattern via Context7 or official documentation before flagging it. Use when the user says 'review code', 'code review', 'check my changes', 'ревью коду', 'перевір код', 'review PR', 'what did I break', 'is this clean', or after implementing a feature, fixing a bug, or refactoring. Also trigger proactively when significant code changes are staged or committed."
argument-hint: "[file path, git ref, or 'staged']"
---

# Code Reviewer — Argustack

Review code changes one file at a time. For each file: read it, find issues, research uncertain patterns, report findings with fixes. Move to the next file only after the current one is done.

This approach preserves context and catches more issues than scanning everything at once.

## Architecture Context

**Tech stack:** TypeScript / Node.js, ESM modules, Commander.js, jira.js, Octokit, es-git, PostgreSQL 16 + pgvector, MCP SDK, Vitest.

**Hexagonal Architecture:**
- `core/types/` — pure data interfaces, zero dependencies
- `core/ports/` — abstract contracts (IStorage, ISourceProvider, IEmbeddingProvider)
- `adapters/` — driven adapters implement core/ports (postgres/, jira/, git/, github/, openai/, csv/, db/)
- `use-cases/` — business logic, depends only on core/
- `mcp/` — driving adapter (Claude MCP tools)
- `cli/` — driving adapter + composition root (wires adapters into use-cases)

**Dependency Rule:** `cli/,mcp/ → use-cases/ → core/ports` ← `adapters/`

Core knows nothing about the outside world. Adapters implement core interfaces. Use-cases depend only on ports. CLI/MCP are composition roots that wire everything together.

## Before You Start

1. Run `date` to know the current date (libraries evolve, APIs change)
2. Determine the scope: what files changed?

```bash
# Staged changes
git diff --cached --name-only --diff-filter=ACMR

# Unstaged changes
git diff --name-only --diff-filter=ACMR

# All uncommitted changes
git diff HEAD --name-only --diff-filter=ACMR

# Changes in last N commits
git diff HEAD~N --name-only --diff-filter=ACMR
```

If `$ARGUMENTS` is a file path — review that single file.
If `$ARGUMENTS` is a git ref (like `HEAD~3`) — review changes since that ref.
If `$ARGUMENTS` is `staged` — review only staged files.
If no arguments — review all uncommitted changes.

Filter to `src/` and `tests/` files only. Skip generated files, configs, docs.

## Step 1: Sort Files by Review Priority

Order changed files by architectural risk:

| Priority | Layer | Why |
|----------|-------|-----|
| 1 | `core/types/`, `core/ports/` | Breaking changes cascade everywhere |
| 2 | `adapters/postgres/schema.ts` | Database schema changes are hard to reverse |
| 3 | `use-cases/` | Business logic bugs |
| 4 | `adapters/` (other) | Implementation correctness |
| 5 | `mcp/tools/` | MCP tool contracts (params, descriptions) |
| 6 | `cli/` | User-facing commands |
| 7 | `tests/` | Test quality and coverage |

## Step 2: Review One File

For each file, read it completely. Then check against this checklist — but think critically, not mechanically. Not every check applies to every file.

### Architecture Checks

**Dependency Rule** — the single most important check:
- Does `core/` import anything outside `core/`? (violation)
- Does a use-case import from `adapters/`? (violation — should use core/ports)
- Does an adapter import from `cli/` or `mcp/`? (violation)
- Does `mcp/` import directly from `adapters/` instead of going through use-cases or the composition root? (violation — unless it's a dynamic import in helpers.ts for adapter construction)

**Port/Adapter Contract:**
- New method on a port (IStorage, ISourceProvider) — is it implemented in all adapters + fakes?
- New type in `core/types/` — is it re-exported from `index.ts`?
- Adapter returns core type, not external library type?

**Layer Placement:**
- Business logic in an adapter? Should be in use-case
- Infrastructure concern (SQL, API call) in use-case? Should be in adapter
- Presentation logic (formatting, chalk, ora) in use-case or adapter? Should be in cli/mcp

### TypeScript Checks

- `any` type used? Usually avoidable with proper typing
- Missing null checks where data can be null?
- `as` type assertions — are they safe? Could a runtime type guard be used instead?
- ESM imports have `.js` extension? (required for ESM)
- Unused imports or variables?

### Code Quality

- Function > 50 lines? Consider if it can be broken down
- Deeply nested logic (3+ levels)? Consider early returns
- Duplicated logic across files? Consider shared utility
- Error handling: caught errors silently swallowed?
- Hardcoded values that should be configurable?

### Project Conventions (from .claude/rules/)

- No `// inline comments` — only TSDoc `/** ... */` where needed
- No `eslint-disable`
- No hardcoded Jira field IDs or project-specific logic
- Commit messages: `type: description` format
- AsyncGenerator for streaming large datasets

### Test Coverage

- New public method or type — is there a test?
- New adapter method — unit test with mocks?
- New use-case logic — integration test with fakes?
- New MCP tool — test in `tests/mcp/server.test.ts` tool list?
- New factory function needed in `tests/fixtures/shared/test-constants.ts`?
- Fake storage/provider updated for new port method?

## Step 3: Research Before Flagging

When you find something that looks wrong but you're not 100% sure:

1. Check Context7 for the relevant library documentation
2. Check the project's existing patterns — maybe this is an intentional convention
3. Only flag it as an issue if you have evidence

Examples of when to research:
- "Is this the correct jira.js v5 API?" → Context7: jira.js docs
- "Is this pgvector query syntax correct?" → Context7: pgvector docs
- "Should zod v4 use z.string() or z.string?" → Context7: zod docs
- "Is this MCP SDK pattern correct?" → Context7: MCP SDK docs

Format research findings concisely:
```
[RESEARCHED] pgvector cosine distance: confirmed `<=>` is correct operator for cosine distance.
Source: pgvector docs via Context7
```

## Step 4: Report Findings for This File

For each file, report:

```
## src/path/to/file.ts

**Layer:** adapters/postgres
**Action:** MODIFY (added hybridSearch method)

### Issues Found

1. **[ARCHITECTURE]** Line 42: Direct import from `adapters/openai` in MCP tool.
   Should go through composition root (createAdapters in helpers.ts).
   Fix: Move embedding provider construction to createAdapters().

2. **[TYPE SAFETY]** Line 78: `as any` cast on query result.
   Fix: Define proper row interface.

### Verified OK

- Dependency rule: imports only from core/ports ✓
- Port contract: hybridSearch matches IStorage signature ✓
- ESM extensions present ✓
```

Severity levels:
- **[ARCHITECTURE]** — dependency rule or layer violation. Always fix
- **[BUG]** — will cause runtime errors or wrong behavior
- **[TYPE SAFETY]** — unsafe casts, missing null checks
- **[CONVENTION]** — project convention violation
- **[SUGGESTION]** — optional improvement, not blocking

## Step 5: Move to Next File

After reporting findings for one file — STOP. Ask yourself: did I miss anything? Then move to the next file in priority order.

Between files, you can run `npm run build` to catch TypeScript errors early, or `npm test` to verify nothing is broken.

## Step 6: Summary

After all files are reviewed, provide a summary:

```
## Review Summary

Files reviewed: N
Issues found: N (X architecture, Y bugs, Z type safety, W convention)
Tests needed: list any missing test coverage

### Critical (must fix before merge)
- ...

### Important (fix soon)
- ...

### Nice to have
- ...
```

## What This Skill Does NOT Do

- Does not review documentation changes (.md files)
- Does not check git commit message format (that's pre-commit hooks)
- Does not run tests automatically (suggest it, don't do it)
- Does not auto-fix issues (report them, let the user decide)
