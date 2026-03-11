# Tests - Testing Guide

## SSOT Fixtures (CRITICAL!)

**Rule:** Changed type/entity → update 1 fixture file → all tests work

```
tests/fixtures/shared/test-constants.ts  ← ONE file
  ↓
All tests import from here
  ↓
Change Issue type → Update 1 file → done ✅
```

**SSOT Rules:**
1. Factory functions for all test data — `createIssue()`, `createBatch()`, etc.
2. Centralized in `fixtures/` — NEVER inline test data
3. Export functions, not objects — `createIssue()` not `testIssue`
4. All IDs in `TEST_IDS` constant

---

## Test Structure

```
tests/
├── fixtures/
│   ├── fakes/          ← In-memory implementations of ports
│   │   ├── fake-storage.ts        (IStorage)
│   │   └── fake-source-provider.ts (ISourceProvider)
│   └── shared/
│       └── test-constants.ts      (SSOT: IDs + factories)
├── unit/
│   ├── adapters/       ← Mapper, provider, storage tests (mocked deps)
│   ├── core/           ← Config, types tests (pure logic)
│   └── workspace/      ← Resolver tests
├── integration/
│   └── use-cases/      ← PullUseCase with fakes (no real DB)
├── mcp/                ← MCP server via InMemoryTransport
├── reporters/
│   └── failed-tests-reporter.ts   ← AI-friendly .log files
└── logs/               ← Generated reports (gitignored)
```

---

## Testing Strategy by Layer

| Layer | Approach | Example |
|-------|----------|---------|
| Core types/config | **Unit** — pure logic | `config.test.ts` |
| Adapters (mapper) | **Unit** — input/output | `jira-mapper.test.ts` |
| Adapters (storage) | **Unit** — mock pg.Pool | `postgres-storage.test.ts` |
| Adapters (provider) | **Unit** — mock jira.js | `jira-provider.test.ts` |
| Use Cases | **Integration** — fakes, no mocks | `pull.test.ts` |
| MCP server | **MCP** — InMemoryTransport | `server.test.ts` |

---

## Vitest Projects

```bash
npm run test            # All projects
npm run test:unit       # unit only
npm run test:integration # integration only
npm run test:mcp        # mcp only
npm run test:watch      # watch mode
npm run test:coverage   # with coverage
```

---

## Test Doubles

| Type | What | Location |
|------|------|----------|
| Fake | In-memory IStorage/ISourceProvider | `fixtures/fakes/` |
| Mock | `vi.mock()` for modules | Inline in test |
| Spy | `vi.fn()` for functions | Inline in test |

**Fakes vs Mocks:**
- Use **fakes** for integration tests (PullUseCase) — test real behavior
- Use **mocks** for unit tests (PostgresStorage) — isolate from dependencies

---

## Pre-commit Quality Gates

| Branch | Behavior | Tests |
|--------|----------|-------|
| **main** | STRICT MODE | ALL tests MUST pass |
| **staging** | FLEXIBLE | Unit tests run, can warn |
| **feature/*** | FLEXIBLE | Unit tests run, can warn |

---

## CI Script

```bash
npm run ci   # = npm run check && npm test
             # check = typecheck + lint
             # test = vitest run (all projects)
```

---

## Test Quality Rules

1. **Tests follow architecture** — if test is ugly, code architecture is wrong
2. **Tests find bad code** — pain in testing = signal to refactor
3. **Never adjust tests to hide problems** — test fails → fix code, not test
4. **SSOT or die** — hardcoded data in tests = tech debt bomb
