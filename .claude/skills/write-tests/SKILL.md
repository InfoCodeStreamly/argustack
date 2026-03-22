---
name: write-tests
description: Write comprehensive tests for Argustack modules following Hexagonal Architecture layers. Spawns parallel agents for SSOT fixtures, unit tests (adapters/core), integration tests (use-cases), MCP tool tests, and architecture checks. Use after implementing a feature, fixing a bug, adding a new adapter, creating MCP tools, or when the user says "write tests", "add tests", "test coverage", "напиши тести", "тести", "покрий тестами". Also trigger proactively when test coverage gaps are detected.
argument-hint: "[layer or module, e.g. 'db adapter', 'mcp tools', 'all', 'pull-db use case']"
---

# Write Tests for Argustack

Write tests for the specified module or layer. Tests are first-class citizens that verify code correctness — they are never adjusted to hide problems in code. If a test is hard to write, the code architecture is wrong.

## Core Principle

**Tests do NOT bend to fit bad code.** If testing is painful, that's a signal to refactor the production code. A failing test means fix the code, not the test. This is non-negotiable.

## Before Writing Tests

Read the project's testing conventions and existing infrastructure:

```bash
cat .claude/rules/tests.md
cat tests/fixtures/shared/test-constants.ts | head -100
ls tests/fixtures/fakes/
tree tests/ -L 2 -d
```

Read the target module:

```bash
# For adapter tests:
tree src/adapters/$ARGUMENTS/ -L 2
# For use-case tests:
cat src/use-cases/$ARGUMENTS.ts
# For MCP tool tests:
cat src/mcp/tools/$ARGUMENTS.ts
# For all:
tree src/ -L 2
```

Check existing tests:

```bash
find tests/ -name "*.test.ts" | sort
```

## Vitest Configuration

The project uses Vitest workspace projects (`vitest.config.ts`):

| Project | Path | Script |
|---------|------|--------|
| `unit` | `tests/unit/**/*.test.ts` | `npm run test:unit` |
| `integration` | `tests/integration/**/*.test.ts` | `npm run test:integration` |
| `mcp` | `tests/mcp/**/*.test.ts` | `npm run test:mcp` |
| `architecture` | `tests/architecture/**/*.test.ts` | `npm run test:arch` |

Config has `globals: true` — so `describe`, `it`, `expect` are available without imports. However, **always import explicitly** from `vitest` for clarity and IDE support. Always import `vi` when using mocks.

Coverage uses v8 provider with 50% thresholds. Custom `failed-tests-reporter.ts` generates AI-friendly `.log` files in `tests/logs/`.

## SSOT Fixtures — The Foundation

Every test imports data from `tests/fixtures/`. Never inline test data.

### Rules

1. **Factory functions** for all test data — `createIssue()`, `createCommit()`, `createPullRequest()`, `createDbTable()`, etc.
2. **All IDs in constants** — `TEST_IDS`, `GIT_TEST_IDS`, `GITHUB_TEST_IDS`, `DB_TEST_IDS`
3. **Export functions, not objects** — `createIssue()` not `testIssue`
4. **Fakes implement ports** — `FakeStorage` implements `IStorage`, `FakeDbProvider` implements `IDbProvider`
5. **Missing factory? Create it first** — never write a test without SSOT data

### When to Update Fixtures

- New type/field added to core → add to factory function
- New port method → add stub to fake
- New adapter → add factory for its data types

## Vitest Mock Cleanup — Choose the Right One

`vi.clearAllMocks()`, `vi.resetAllMocks()`, and `vi.restoreAllMocks()` do different things. Using the wrong one causes flaky tests or leaked state:

| Method | Clears call history | Resets implementation | Restores original |
|--------|--------------------|-----------------------|-------------------|
| `vi.clearAllMocks()` | Yes | No | No |
| `vi.resetAllMocks()` | Yes | Yes (returns `undefined`) | No |
| `vi.restoreAllMocks()` | Yes | Yes | Yes |

**Default for this project: `vi.clearAllMocks()` in `beforeEach`** — because `vi.mock()` factory sets the implementation once at hoisting time, and we want to keep it across tests while clearing call counts. Use `vi.restoreAllMocks()` only for `vi.spyOn()` patterns where original behavior must be restored.

## Test Strategy by Layer

### Unit Tests (`tests/unit/`)

Test individual functions in isolation. Mock external dependencies.

| What | How | Example |
|------|-----|---------|
| **Adapter mappers** | Pure input/output, no mocks needed | `jira-mapper.test.ts` |
| **Adapter providers** | Mock the underlying client (jira.js, Octokit, Knex, pg.Pool) | `jira-provider.test.ts` |
| **Adapter storage** | Mock `pg.Pool.query()`, verify SQL and params | `postgres-storage.test.ts` |
| **SQL validator** | Pure function, all statement types | `sql-validator.test.ts` |
| **Core config** | Pure logic, parseConfig, createEmptyConfig | `config.test.ts` |
| **Workspace resolver** | Mock filesystem, test path walking | `resolver.test.ts` |
| **MCP helpers** | Mock workspace/storage, test response formatting | `mcp-helpers.test.ts` |
| **CLI generators** | Mock filesystem, verify generated file content | `generators.test.ts` |
| **Estimate helpers** | Pure math functions (businessHours, familiarity, baseHours) | `estimate-helpers.test.ts` |

### vi.mock() Hoisting and Dynamic Imports

`vi.mock()` is hoisted to the top of the file — it runs BEFORE any imports. This means you **cannot reference test variables** inside the factory. When you need shared mock references, use the **dynamic import in `beforeEach`** pattern (established in `postgres-storage.test.ts`):

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createBatch, TEST_IDS } from '../../fixtures/shared/test-constants.js';

// 1. vi.mock() — hoisted, sets up module replacement
vi.mock('../../../src/adapters/postgres/connection.js', () => ({
  createPool: vi.fn(),
}));

// 2. Declare typed variables for mocked modules
let PostgresStorage: typeof import('../../../src/adapters/postgres/storage.js').PostgresStorage;
let createPool: typeof import('../../../src/adapters/postgres/connection.js').createPool;

// 3. Dynamic import in beforeEach — gets the mocked version
beforeEach(async () => {
  vi.clearAllMocks();
  const storageModule = await import('../../../src/adapters/postgres/storage.js');
  const connectionModule = await import('../../../src/adapters/postgres/connection.js');
  PostgresStorage = storageModule.PostgresStorage;
  createPool = connectionModule.createPool;
});

describe('PostgresStorage', () => {
  it('should call createPool with config', async () => {
    // Use the dynamically imported, mocked module
    const mockPool = createMockPool();
    vi.mocked(createPool).mockReturnValue(mockPool);

    const storage = new PostgresStorage(DB_CONFIG);
    await storage.init();

    expect(createPool).toHaveBeenCalledWith(DB_CONFIG);
  });
});
```

The key insight: `vi.mock()` replaces the module at hoist time, then `await import()` in `beforeEach` gives you access to the mocked version with fresh state each test.

### Partial Mocking with importOriginal

When you need to mock only some exports while keeping others real (useful for testing one function that depends on another from the same module):

```typescript
vi.mock('../../../src/workspace/config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/workspace/config.js')>();
  return {
    ...actual,
    loadConfig: vi.fn().mockResolvedValue(testConfig),
    // parseConfig stays real
  };
});
```

### Testing AsyncGenerators

Argustack's data flow relies heavily on AsyncGenerators (`pullIssues()`, `pullCommits()`, `pullPullRequests()`, `introspect()`). Pattern for consuming them in tests:

```typescript
it('should yield batches from provider', async () => {
  const provider = new FakeSourceProvider([createBatch(), createBatch()]);

  const batches: IssueBatch[] = [];
  for await (const batch of provider.pullIssues('TEST')) {
    batches.push(batch);
  }

  expect(batches).toHaveLength(2);
  expect(batches[0]?.issues).toHaveLength(1);
});
```

For testing that a generator yields nothing:

```typescript
it('should yield empty when no data', async () => {
  const batches: IssueBatch[] = [];
  for await (const batch of provider.pullIssues('EMPTY')) {
    batches.push(batch);
  }
  expect(batches).toHaveLength(0);
});
```

### Testing Error Cases

Async errors — use `.rejects.toThrow()`:

```typescript
it('should throw when not connected', async () => {
  await expect(provider.query('SELECT 1')).rejects.toThrow('Not connected');
});
```

Sync errors — wrap in arrow function:

```typescript
it('should reject DELETE statements', () => {
  const result = validateSql('DELETE FROM users');
  expect(result.valid).toBe(false);
  expect(result.reason).toContain('forbidden');
});
```

### Integration Tests (`tests/integration/`)

Test use cases with **fakes** (in-memory port implementations), not mocks. Fakes verify real orchestration logic without external dependencies.

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { FakeStorage } from '../../fixtures/fakes/fake-storage.js';
import { FakeSourceProvider } from '../../fixtures/fakes/fake-source-provider.js';
import { PullUseCase } from '../../../src/use-cases/pull.js';
import { createProject, createBatch, TEST_IDS } from '../../fixtures/shared/test-constants.js';

describe('PullUseCase', () => {
  let source: FakeSourceProvider;
  let storage: FakeStorage;
  let useCase: PullUseCase;

  // Fresh instances per test — no shared state
  beforeEach(() => {
    source = new FakeSourceProvider();
    storage = new FakeStorage();
    useCase = new PullUseCase(source, storage);
  });

  it('should save batches from provider to storage', async () => {
    source.seedProjects([createProject()]);
    source.seedBatches(TEST_IDS.projectKey, [createBatch()]);

    const results = await useCase.execute();

    expect(results).toHaveLength(1);
    expect(storage.savedBatches).toHaveLength(1);
  });
});
```

The pattern: `beforeEach` creates fresh fakes → seed test data → execute use case → assert on fake's recorded state (`storage.savedBatches`, `storage.initialized`, etc.).

### MCP Tests (`tests/mcp/`)

Test MCP tools via `InMemoryTransport` — the real MCP SDK transport that works without stdio. The server must be **dynamically imported** to avoid side effects at module level.

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { TEST_IDS } from '../fixtures/shared/test-constants.js';

describe('MCP: tool_name', () => {
  let client: Client;
  let clientTransport: InMemoryTransport;
  let serverTransport: InMemoryTransport;

  beforeAll(async () => {
    [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    // Dynamic import — avoids side effects at module level
    const { server } = await import('../../src/mcp/server.js');

    client = new Client({ name: 'test-client', version: '1.0.0' });

    // server.server for McpServer wrapper; direct .connect() for raw Server
    await server.server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await clientTransport.close();
    await serverTransport.close();
  });

  it('should return expected format', async () => {
    const result = await client.callTool({
      name: 'tool_name',
      arguments: { param: 'value' },
    });
    // MCP tools return { content: [{ type: 'text', text: '...' }] }
    expect(result.content).toBeDefined();
    expect(Array.isArray(result.content)).toBe(true);
  });
});
```

Each MCP tool gets tested for:
- **Happy path** — correct parameters, expected output format
- **Error handling** — missing workspace, invalid params, tool returns `isError: true`
- **Edge cases** — empty DB, filters that match nothing

The MCP server reads `ARGUSTACK_WORKSPACE` env var. Without a real workspace, `workspace_info` returns "not found". These tests verify tools are registered and respond, not that they return real data (that's integration-level).

### Architecture Tests (`tests/architecture/`)

Meta-tests that verify codebase rules by scanning source files — no runtime execution, pure filesystem assertions:

- No hardcoded Jira project keys or issue IDs in source code
- No `eslint-disable` comments (except test files with `@typescript-eslint/unbound-method` for mock assertions)
- All ports have corresponding fakes in test fixtures
- All MCP tools are registered in server.ts
- Every `SourceType` has a `SOURCE_META` entry

## Pure Function Tests — Simplest Pattern

For pure functions (mappers, validators, math helpers), no mocks needed. Just input → output:

```typescript
import { describe, it, expect } from 'vitest';
import { mapJiraIssue } from '../../../src/adapters/jira/mapper.js';
import { TEST_IDS } from '../../fixtures/shared/test-constants.js';

describe('mapJiraIssue', () => {
  it('should map raw Jira issue to core Issue type', () => {
    const raw = createRawJiraIssue();

    const result = mapJiraIssue(raw, TEST_IDS.projectKey);

    expect(result.key).toBe(TEST_IDS.issueKey);
    expect(result.summary).toBe('Fix login bug');
    expect(result.issueType).toBe('Bug');
  });

  it('should handle null fields gracefully', () => {
    const raw = createRawJiraIssue({
      fields: { ...minimalFields, assignee: null, resolution: null },
    });

    const result = mapJiraIssue(raw, TEST_IDS.projectKey);

    expect(result.assignee).toBeNull();
    expect(result.resolution).toBeNull();
  });
});
```

Raw data factory functions for adapter-specific types (like `createRawJiraIssue`) live **inside the test file** — they're adapter-specific and won't be reused. Only core type factories (`createIssue()`, `createCommit()`) go in SSOT `test-constants.ts`.

## Parallel Execution Plan

When writing tests for a full module or "all", spawn agents in parallel:

```
Agent 1: SSOT Fixtures     → must finish FIRST (others depend on it)
Agent 2: Unit Adapters      → starts after Agent 1
Agent 3: Unit Core/Helpers  → starts after Agent 1
Agent 4: Integration        → starts after Agent 1
Agent 5: MCP Tools          → starts after Agent 1
Agent 6: Architecture       → starts IMMEDIATELY (no dependencies)
```

For a single layer (e.g. "db adapter"), run sequentially: fixtures first, then tests.

## Quality Gates

After writing tests:

```bash
npm run ci    # typecheck + lint + ALL tests
```

Every test must:
- **Pass** — no skipped tests, no `.todo()`
- **Use SSOT fixtures** — zero inline test data objects with 3+ fields
- **Have descriptive names** — `it('should reject DELETE statements')` not `it('works')`
- **Test behavior, not implementation** — verify outputs, not internal state
- **Be independent** — no test depends on another test's side effects
- **Use `beforeEach` for fresh state** — never share mutable state between tests

## What NOT to Test

- Pure TypeScript interfaces (`core/ports/`) — they have no runtime behavior
- Type re-exports (`core/types/index.ts`) — just barrel files
- CLI interactive prompts directly — test the pure logic they call instead
- Docker/process management — infrastructure concerns

## Output Summary

After completing tests, report:

```
Module: $ARGUMENTS
Fixtures updated: N factory functions, N fakes
Unit tests: N files, N test cases
Integration tests: N files, N test cases
MCP tests: N tools covered, N test cases
Architecture tests: N checks
CI: npm run ci — PASS/FAIL
```
