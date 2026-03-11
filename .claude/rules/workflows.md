# Development Workflows

---

## Core Workflow: Explore → Plan → Code → Commit

### Phase 1: Explore
```bash
tree src/ -L 2
Grep: "pattern" --output="files_with_matches"
Read: relevant files only
```

### Phase 2: Plan
```
TodoWrite:
- Specific tasks
- Group by layers (core, adapters, CLI, MCP)
- Exact file paths
```

### Phase 3: Code
```
Core → Adapters → Use Cases → CLI/MCP

# After each file:
TodoWrite: mark completed
```

### Phase 4: Commit
```bash
npm run ci  # typecheck + lint + tests
# Only when user requests!
```

---

## Git Branches

- `main` — production. **NEVER commit directly**
- `staging` — development. All code goes here first
- `feature/*` — merge into `staging` before main

---

## Context Management

### When to `/clear`
- Switching major features
- After completing large TODO
- Starting unrelated work

---

## Architecture: Clean Architecture (Hexagonal)

```
core/ports/     ← Interfaces (IStorage, ISourceProvider)
core/types/     ← Domain types (Issue, Project, etc.)
adapters/       ← Implementations (postgres/, jira/)
use-cases/      ← Business logic (PullUseCase)
mcp/            ← MCP server (tools)
cli/            ← CLI commands
workspace/      ← Config, resolver
```

**Dependency Rule:** Core knows nothing about adapters. Adapters implement core ports.
